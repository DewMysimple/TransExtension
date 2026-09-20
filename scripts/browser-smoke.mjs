// Optional real-browser DOM checks. Synthetic pages and chrome API stubs do not
// replace an authenticated-site/manual extension acceptance pass.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const executable = process.argv[2];
if (!executable) throw new Error('Usage: node scripts/browser-smoke.mjs <absolute Chrome/Edge executable>');
await fs.access(executable);
const projects = ['figma-zh-ui', 'github-zh-ui'];
const scripts = ['generated/dictionary.js', 'src/official-overrides.js', 'src/core.js', 'src/content.js'];
const assets = new Map();
for (const project of projects) {
  for (const script of scripts) assets.set('/' + project + '/' + script, await fs.readFile(path.join(root, project, script), 'utf8'));
}

function browserSetup(project) {
  window.smokeProject = project;
  window.smokeStorage = [];
  window.smokeMessages = [];
  window.smokeAudits = [];
  window.chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener(listener) { window.smokeMessages.push(listener); } },
      sendMessage(message, callback) { window.smokeAudits.push(message); callback?.({}); }
    },
    storage: {
      local: { async get() { return { settings: { enabled: true, auditEnabled: true, showOriginal: true } }; } },
      onChanged: { addListener(listener) { window.smokeStorage.push(listener); } }
    }
  };
}

async function browserChecks() {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const isFigma = window.smokeProject === 'figma-zh-ui';
  const prefix = isFigma ? 'figma' : 'github';
  const button = document.querySelector('#action');
  let count = 0;
  try {
    await wait(200);
    assert(button.textContent !== 'Settings' && /[\u3400-\u9fff]/.test(button.textContent), 'fixed UI did not translate'); count++;
    assert(document.querySelector('#protected').textContent === 'Settings', 'protected content changed'); count++;
    assert(document.querySelector('#input').value === 'Settings', 'input value changed'); count++;
    const translated = button.textContent;
    history.pushState({}, '', isFigma ? '/design/synthetic/example' : '/synthetic/repository/settings');
    document.querySelector('main').append(document.createElement('div'));
    await wait(250);
    assert(button.textContent === translated, 'retained navigation was not translated after route change'); count++;
    const dynamic = document.createElement('button');
    dynamic.textContent = 'Settings';
    document.querySelector('main').append(dynamic);
    await wait(150);
    assert(dynamic.textContent === translated, 'dynamic button did not translate'); count++;
    if (isFigma) {
      assert(document.querySelector('#label').textContent === '自动布局', 'split i18n label did not translate'); count++;
      assert(document.querySelector('#hint').title === '搜索', 'title did not translate'); count++;
    }
    const node = dynamic.firstChild;
    dynamic.setAttribute('contenteditable', '');
    await wait(150);
    assert(node.nodeValue === 'Settings', 'editable transition did not restore'); count++;
    dynamic.removeAttribute('contenteditable');
    await wait(150);
    dynamic.remove();
    await wait(150);
    assert(dynamic.textContent === 'Settings', 'removed node did not restore'); count++;
    const unknown = document.createElement('button');
    unknown.textContent = 'Synthetic mystery action';
    document.querySelector('[role="dialog"]').append(unknown);
    await wait(150);
    const batchCount = window.smokeAudits.length;
    for (const listener of window.smokeStorage) listener({ settings: { newValue: { enabled: false, auditEnabled: true, showOriginal: true } } }, 'local');
    await wait(1300);
    assert(button.textContent === 'Settings', 'disable did not restore'); count++;
    assert(window.smokeAudits.length === batchCount, 'audit flushed after disable'); count++;
    assert(!button.hasAttribute('data-' + prefix + '-zh-original'), 'stale original marker remained'); count++;
    document.documentElement.setAttribute('data-smoke-result', 'PASS:' + count);
  } catch (error) {
    document.documentElement.setAttribute('data-smoke-result', 'FAIL:' + error.message);
  }
}

function page(project) {
  const protectedMarkup = project === 'figma-zh-ui'
    ? '<a href="/design/synthetic/example"><span id="protected">Settings</span></a>'
    : '<div class="markdown-body" id="protected">Settings</div>';
  const html = '<!doctype html><html><head><meta charset="utf-8"></head><body>'
    + '<nav><button id="action">Settings</button></nav>' + protectedMarkup
    + '<input id="input" value="Settings"><main></main><div role="dialog"></div>'
    + (project === 'figma-zh-ui' ? '<div translate="no"><i18n-text id="label">Auto <span>layout</span></i18n-text><button id="hint" title="Search"></button></div>' : '')
    + '<script>(' + browserSetup.toString() + ')(' + JSON.stringify(project) + ');</script>'
    + scripts.map((script) => '<script src="/' + project + '/' + script + '"></script>').join('')
    + '<script>(' + browserChecks.toString() + ')();</script></body></html>';
  return html;
}

const server = http.createServer((req, res) => {
  const project = projects.find((item) => req.url === '/' + item);
  const body = project ? page(project) : assets.get(req.url);
  res.writeHead(body === undefined ? 404 : 200, { 'Content-Type': project ? 'text/html; charset=utf-8' : 'application/javascript; charset=utf-8' });
  res.end(body ?? '');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'trans-extension-browser-'));
try {
  for (const project of projects) {
    const args = ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--disable-background-networking', '--disable-extensions', '--user-data-dir=' + path.join(temporary, project),
      '--dump-dom', '--virtual-time-budget=6000', 'http://127.0.0.1:' + server.address().port + '/' + project];
    const output = await new Promise((resolve, reject) => {
      const child = spawn(executable, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Browser smoke timed out')); }, 30_000);
      child.stdout.on('data', (data) => { stdout += data; });
      child.stderr.on('data', (data) => { stderr += data; });
      child.on('error', (error) => { clearTimeout(timeout); reject(error); });
      child.on('close', (code) => {
        clearTimeout(timeout);
        if (code !== 0) reject(new Error('Browser exit ' + code + ': ' + stderr.slice(-1500)));
        else resolve({ stdout, stderr });
      });
    });
    const result = output.stdout.match(/data-smoke-result="([^"]+)"/)?.[1];
    assert.match(result ?? '', /^PASS:/, project + ': ' + (result ?? 'missing browser result; ' + output.stderr.slice(-1500)));
    console.log(project + ' ' + result + ' (synthetic DOM, ' + path.basename(executable) + ')');
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
  // Only remove the exact disposable directory returned by mkdtemp above.
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()));
  assert.match(path.basename(temporary), /^trans-extension-browser-/);
  await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
