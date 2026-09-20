import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');
const errors = [];
const args = process.argv.slice(2);
const offline = args.includes('--offline');
if (args.some((argument) => argument !== '--offline')) errors.push('只支持 --offline 参数。');

async function read(relativePath) {
  return fs.readFile(path.join(rootDir, relativePath), 'utf8');
}

function check(condition, message) {
  if (!condition) errors.push(message);
}

const manifest = JSON.parse(await read('manifest.json'));
const packageJson = JSON.parse(await read('package.json'));
const packageLock = JSON.parse(await read('package-lock.json'));
check(manifest.manifest_version === 3, 'manifest_version 必须为 3。');
check(JSON.stringify(manifest.host_permissions) === JSON.stringify(['https://www.figma.com/*']), '主机权限必须仅包含 www.figma.com。');
check(JSON.stringify([...(manifest.permissions ?? [])].sort()) === JSON.stringify(['activeTab', 'storage']), '权限必须仅包含 storage 和 activeTab。');
check(!(manifest.optional_permissions?.length || manifest.optional_host_permissions?.length), '不得新增可选权限。');
check(manifest.version === packageJson.version && manifest.version === packageLock.version && manifest.version === packageLock.packages?.['']?.version, 'manifest、package 与锁文件版本必须一致。');
check(manifest.background?.service_worker === 'src/background.js' && manifest.action?.default_popup === 'src/popup.html', '后台或弹窗入口不正确。');
check(manifest.content_scripts?.length === 1, '必须只有一组内容脚本。');
const contentScript = manifest.content_scripts?.[0];
check(JSON.stringify(contentScript?.matches) === JSON.stringify(manifest.host_permissions), '内容脚本匹配范围必须等于目标主机权限。');
check(JSON.stringify(contentScript?.js) === JSON.stringify(['generated/dictionary.js', 'src/official-overrides.js', 'src/core.js', 'src/content.js']), '内容脚本加载顺序必须为 dictionary → overrides → core → content。');
check(JSON.stringify(contentScript?.css) === JSON.stringify(['src/content.css']) && contentScript?.run_at === 'document_start', '内容脚本样式或加载时机不正确。');

const requiredFiles = [
  'manifest.json', 'src/background.js', 'src/content.js', 'src/content.css', 'src/core.js',
  'src/official-overrides.js', 'src/popup.html', 'src/popup.css', 'src/popup.js',
  'generated/dictionary.js', 'generated/sources.json', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md'
];
for (const relativePath of requiredFiles) {
  try { await fs.access(path.join(rootDir, relativePath)); }
  catch { errors.push(`缺少交付文件：${relativePath}`); }
}

const sources = JSON.parse(await read('generated/sources.json'));
check(sources.runtimeNetworkRequests === false, '来源元数据必须声明运行时不联网。');
const generatedAt = Date.parse(sources.generatedAt);
check(Number.isFinite(generatedAt) && generatedAt <= Date.now(), '来源生成日期无效或位于未来。');
if (!offline && Number.isFinite(generatedAt)) check(Date.now() - generatedAt <= 24 * 60 * 60 * 1000, '来源元数据已超过 24 小时。');
check(/^[a-f0-9]{40}$/.test(sources.upstream?.sha ?? ''), '上游提交 SHA 无效。');
check(sources.upstream?.repo === 'Figma-Cool/figmaCN', '上游词库仓库不正确。');

const sandbox = { globalThis: {} };
vm.createContext(sandbox);
vm.runInContext(await read('generated/dictionary.js'), sandbox, { timeout: 20_000 });
const dictionary = sandbox.globalThis.FIGMA_ZH_DICTIONARY;
check(dictionary?.meta?.license === 'GPL-3.0-only', '词库许可证元数据无效。');
check(Object.keys(dictionary?.exact ?? {}).length > 4_000, '精确词条数量异常。');
check((dictionary?.patterns ?? []).length > 40, '模板词条数量异常。');

async function checkRuntime(directory) {
  for (const entry of await fs.readdir(path.join(rootDir, directory), { withFileTypes: true })) {
    const runtimeFile = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await checkRuntime(runtimeFile);
    else if (entry.name.endsWith('.js')) {
      const source = await read(runtimeFile);
      try { new vm.Script(source, { filename: runtimeFile }); }
      catch (error) { errors.push(`${runtimeFile} 存在语法错误：${error.message}`); }
      check(!/\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\s*\(/.test(source), `${runtimeFile} 包含运行时网络调用。`);
      check(!/\b(?:importScripts|import)\s*\(\s*['"](?:https?:)?\/\//.test(source), `${runtimeFile} 包含远程脚本导入。`);
    }
  }
}
await checkRuntime('src');

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(`${offline ? '离线静态验证通过（未检查来源 24 小时时效，不代表可发布）' : '验证通过'}：${Object.keys(dictionary.exact).length} 个精确词条，${dictionary.patterns.length} 个模板词条。`);
}
