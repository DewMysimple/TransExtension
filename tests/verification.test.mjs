import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function fixture(t, project) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'trans-extension-verify-'));
  t.after(async () => {
    // Never remove a caller-supplied or repository directory during fixture cleanup.
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert.match(path.basename(directory), /^trans-extension-verify-/);
    await fs.rm(directory, { recursive: true, force: true });
  });
  for (const file of ['manifest.json', 'package.json', 'package-lock.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'src', 'generated/dictionary.js', 'generated/sources.json', 'scripts/verify-project.mjs']) {
    const destination = path.join(directory, file);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.cp(path.join(repoRoot, project, file), destination, { recursive: true });
  }
  const updateJson = async (file, mutate) => {
    const target = path.join(directory, file);
    const value = JSON.parse(await fs.readFile(target, 'utf8'));
    mutate(value);
    await fs.writeFile(target, JSON.stringify(value));
  };
  // Freshness tests never rewrite checked-in source metadata or contact upstream.
  await updateJson('generated/sources.json', (sources) => {
    sources.generatedAt = new Date(Date.now() - 60_000).toISOString();
  });
  return {
    directory,
    updateJson,
    run: (...args) => {
      const result = spawnSync(process.execPath, ['scripts/verify-project.mjs', ...args], {
        cwd: directory,
        encoding: 'utf8',
        windowsHide: true
      });
      assert.ifError(result.error);
      return { status: result.status, output: result.stdout + result.stderr };
    }
  };
}

function passes(result) {
  assert.equal(result.status, 0, result.output);
}

function fails(result, expected) {
  assert.equal(result.status, 1, result.output);
  assert.match(result.output, expected);
}

// Run the same policy contracts against both standalone verifier entry points.
for (const project of ['figma-zh-ui', 'github-zh-ui']) {
  test(`${project}: fresh sources pass release verification from an independent directory`, async (t) => {
    const f = await fixture(t, project);
    passes(f.run());
  });

  test(`${project}: offline verification permits old sources but release verification rejects them`, async (t) => {
    const f = await fixture(t, project);
    await f.updateJson('generated/sources.json', (sources) => { sources.generatedAt = '2000-01-01T00:00:00.000Z'; });
    const offline = f.run('--offline');
    passes(offline);
    assert.match(offline.output, /不代表可发布/);
    fails(f.run(), /24 小时/);
  });

  for (const timestamp of ['invalid', '2999-01-01T00:00:00.000Z']) {
    test(`${project}: offline verification still rejects invalid timestamp ${timestamp}`, async (t) => {
      const f = await fixture(t, project);
      await f.updateJson('generated/sources.json', (sources) => { sources.generatedAt = timestamp; });
      fails(f.run('--offline'), /生成日期无效/);
    });
  }

  for (const permissionField of ['permissions', 'optional_permissions', 'optional_host_permissions']) {
    test(`${project}: rejects expansion of ${permissionField}`, async (t) => {
      const f = await fixture(t, project);
      await f.updateJson('manifest.json', (manifest) => {
        manifest[permissionField] = [...(manifest[permissionField] ?? []), permissionField.includes('host') ? 'https://example.com/*' : 'scripting'];
      });
      fails(f.run('--offline'), /权限/);
    });
  }

  test(`${project}: rejects content scripts outside the declared host`, async (t) => {
    const f = await fixture(t, project);
    await f.updateJson('manifest.json', (manifest) => { manifest.content_scripts[0].matches.push('https://example.com/*'); });
    fails(f.run('--offline'), /匹配范围/);
  });

  test(`${project}: rejects content script load order drift`, async (t) => {
    const f = await fixture(t, project);
    await f.updateJson('manifest.json', (manifest) => { manifest.content_scripts[0].js.reverse(); });
    fails(f.run('--offline'), /加载顺序/);
  });

  test(`${project}: rejects inconsistent manifest and package versions`, async (t) => {
    const f = await fixture(t, project);
    await f.updateJson('manifest.json', (manifest) => { manifest.version = '99.0.0'; });
    fails(f.run('--offline'), /版本必须一致/);
  });

  test(`${project}: offline verification still rejects invalid provenance`, async (t) => {
    const f = await fixture(t, project);
    await f.updateJson('generated/sources.json', (sources) => { (sources.upstream ?? sources.sources[0]).sha = 'invalid'; });
    fails(f.run('--offline'), /SHA 无效/);
  });

  test(`${project}: rejects a missing required delivery file`, async (t) => {
    const f = await fixture(t, project);
    await fs.unlink(path.join(f.directory, 'LICENSE'));
    fails(f.run('--offline'), /缺少交付文件：LICENSE/);
  });

  test(`${project}: checks overrides and newly added runtime subdirectories for network calls`, async (t) => {
    const f = await fixture(t, project);
    await fs.appendFile(path.join(f.directory, 'src/official-overrides.js'), '\nfetch("https://example.com");');
    await fs.mkdir(path.join(f.directory, 'src/helpers'));
    await fs.writeFile(path.join(f.directory, 'src/helpers/network.js'), 'new WebSocket("wss://example.com");');
    const result = f.run('--offline');
    fails(result, /official-overrides\.js 包含运行时网络调用/);
    assert.match(result.output, /helpers\/network\.js 包含运行时网络调用/);
  });

  test(`${project}: permits local worker imports but rejects remote imports`, async (t) => {
    const f = await fixture(t, project);
    const background = path.join(f.directory, 'src/background.js');
    await fs.appendFile(background, '\nimportScripts("core.js");');
    passes(f.run('--offline'));
    await fs.appendFile(background, '\nimportScripts("https://example.com/remote.js");');
    fails(f.run('--offline'), /远程脚本导入/);
  });

  test(`${project}: checks JavaScript syntax before delivery`, async (t) => {
    const f = await fixture(t, project);
    await fs.appendFile(path.join(f.directory, 'src/content.js'), '\nconst = ;');
    fails(f.run('--offline'), /语法错误/);
  });

  test(`${project}: rejects unknown verifier flags instead of weakening checks`, async (t) => {
    const f = await fixture(t, project);
    fails(f.run('--skip-everything'), /只支持 --offline/);
  });
}
