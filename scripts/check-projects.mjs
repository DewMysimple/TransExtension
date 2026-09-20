import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCli = process.env.npm_execpath;
if (!npmCli) throw new Error('请从仓库根目录运行 npm run check。');

// Invoke npm through Node instead of shell interpolation or platform-specific npm.cmd.
// Each plugin keeps its own scripts, dependencies and independently runnable checks.
const checks = [
  ['.', 'test:tooling'],
  ...['figma-zh-ui', 'github-zh-ui'].flatMap((project) => [[project, 'test'], [project, 'verify:offline']]),
  ['.', 'check:memory']
];
const failures = [];
for (const [project, script] of checks) {
  console.log(`\n[${project}] npm run ${script}`);
  const result = spawnSync(process.execPath, [npmCli, 'run', script], {
    cwd: path.join(rootDir, project),
    stdio: 'inherit',
    windowsHide: true
  });
  if (result.error) console.error(result.error.message);
  if (result.status !== 0) failures.push(`${project}: ${script}`);
}
if (failures.length) {
  console.error(`\n检查失败：${failures.join('；')}`);
  process.exitCode = 1;
} else {
  console.log('\n双插件测试、离线静态验证与工程记忆检查通过。发布前仍需各插件 npm run verify 和浏览器验收。');
}
