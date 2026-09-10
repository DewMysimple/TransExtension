import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const errors = [];

async function read(relativePath) {
  return fs.readFile(path.join(rootDir, relativePath), 'utf8');
}

function check(condition, message) {
  if (!condition) errors.push(message);
}

const manifest = JSON.parse(await read('manifest.json'));
check(manifest.manifest_version === 3, 'manifest_version 必须是 3。');
check(JSON.stringify(manifest.host_permissions) === JSON.stringify(['https://github.com/*']), '主机权限必须仅包含 github.com。');
check(manifest.permissions.includes('storage') && manifest.permissions.includes('activeTab'), '缺少 storage 或 activeTab 权限。');
check(!manifest.permissions.some((permission) => ['cookies', 'history', 'downloads', 'webRequest'].includes(permission)), '清单包含禁止的高风险权限。');

const packagedFiles = [
  'manifest.json', 'src/background.js', 'src/content.js', 'src/content.css',
  'src/core.js', 'src/official-overrides.js', 'src/popup.html', 'src/popup.css',
  'src/popup.js', 'generated/dictionary.js', 'generated/sources.json',
  'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'
];
for (const relativePath of packagedFiles) {
  try { await fs.access(path.join(rootDir, relativePath)); }
  catch { errors.push(`缺少交付文件：${relativePath}`); }
}

const sources = JSON.parse(await read('generated/sources.json'));
check(sources.runtimeNetworkRequests === false, '来源元数据必须声明运行时不联网。');
check(Date.now() - Date.parse(sources.generatedAt) <= 24 * 60 * 60 * 1000, '来源元数据超过 24 小时。');
check(sources.sources.length === 4, '来源仓库数量不正确。');
for (const source of sources.sources) check(/^[a-f0-9]{40}$/.test(source.sha), `${source.id} 的 SHA 无效。`);

const dictionarySandbox = { globalThis: {} };
vm.createContext(dictionarySandbox);
vm.runInContext(await read('generated/dictionary.js'), dictionarySandbox, { timeout: 30_000 });
const dictionary = dictionarySandbox.globalThis.GITHUB_ZH_DICTIONARY;
check(dictionary?.meta?.license === 'GPL-3.0-only', '词库许可证元数据无效。');
check(Object.keys(dictionary?.base?.exact ?? {}).length > 5_000, '基础词库数量异常。');
check(Object.keys(dictionary?.scopes ?? {}).length > 200, '页面词库数量异常。');

for (const runtimeFile of ['src/background.js', 'src/content.js', 'src/core.js', 'src/popup.js']) {
  const source = await read(runtimeFile);
  check(!/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(source), `${runtimeFile} 包含运行时网络调用。`);
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`验证通过：${Object.keys(dictionary.base.exact).length} 个基础词条，${Object.keys(dictionary.scopes).length} 个页面词库。`);
}
