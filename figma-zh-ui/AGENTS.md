# AGENTS.md — figma-zh-ui 局部规则

本文件适用于 `figma-zh-ui/`，并继承仓库根 `../AGENTS.md`。工程记忆仍统一写入根目录；属于本插件的页面和日志使用 `project: figma-zh-ui`。

## 产品不变量

- 仅在 `https://www.figma.com/*` 翻译可以确认的 Figma 固定界面文字。
- 文件名、项目名、团队名、图层名、画布/设计文字、变量名、评论、可拖拽项目、文本框和可编辑区域必须保持原样。
- 不确定是否属于固定 UI 时宁可漏译，不得误改设计内容或用户内容。
- 运行时不得使用 `fetch`、`XMLHttpRequest`、`WebSocket` 或 `EventSource` 获取脚本、词库或翻译。
- `host_permissions` 只允许 Figma；不得无理由新增 cookies、history、downloads、webRequest、scripting 等高风险权限。
- 本地漏译审计只接受安全白名单内的菜单、弹窗按钮及明确无障碍标签控件；不得保存完整 URL、文件名、图层、评论或输入内容，也不得上传报告。
- 关闭扩展后，仍在 DOM 中的译文必须可恢复为原始英文。

## 主要文件

- `src/core.js`：词条选择、文本处理、保护判断和可测试核心逻辑。
- `src/content.js`：动态 DOM、SPA 导航、翻译、恢复和漏译审计。
- `src/official-overrides.js`：人工审校的官方术语与覆盖词条。
- `src/background.js`：设置与本地审计数据。
- `src/popup.*`：扩展开关、统计、导出与清空界面。
- `generated/dictionary.js`、`generated/sources.json`：来源更新生成且需要提交的交付输入，不手工编辑。
- `dist/`：打包输出，不提交。

manifest 的内容脚本加载顺序是 dictionary → official overrides → core → content；改名或调整职责时同步检查 `manifest.json`。

## 命令与验证

在本目录使用 Node.js 22+：

```powershell
npm ci
npm test
npm run verify
```

- 核心匹配、保护和翻译行为测试写入 `tests/core.test.mjs`。
- 动态节点、用户内容排除、审计与可逆恢复测试写入 `tests/content.test.mjs`。
- `verify` 的来源元数据有 24 小时时效门槛；普通改动遇到单纯过期应记录为已知限制，不擅自更新上游。
- 更新词库或发布时才执行 `npm run update:sources` → `npm test` → `npm run verify` → `npm run package`，并审查生成词库、来源 SHA、许可证和第三方声明。
- 版本变更同步检查 `manifest.json`、`package.json`、`package-lock.json` 和打包脚本中的固定文件名。
- 高风险 DOM/保护逻辑改动按 README 覆盖 Figma 文件浏览器、Design、FigJam、Slides、设置和团队管理做人工验收，重点确认设计与用户内容完全未改变。

保留并维护本目录现有 `README.md`；安装、权限、词库来源或验收行为改变时同步更新它。
