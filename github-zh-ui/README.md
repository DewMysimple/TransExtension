# GitHub 简体中文界面

一个面向 Chrome 和 Edge 的离线 Manifest V3 扩展。它翻译 `github.com` 的固定导航、按钮、菜单、提示和设置页面，同时跳过代码、README、Issue/PR 正文、评论、文件名、仓库名、用户名和输入内容。

## 主要特性

- 固定词库离线运行，不调用翻译 API，不在运行时下载脚本或词库。
- 覆盖 GitHub 首页、仓库、Issue、Pull Request、Actions、个人设置、仓库设置和组织设置。
- 支持 GitHub Turbo 无刷新导航、异步菜单和弹窗。
- 默认显示简体中文；在译文上悬停约 0.4 秒可查看原始英文。
- 可随时关闭，扩展会恢复仍在页面上的原始英文。
- 未收录的候选固定词条会进入本地审计；报告只含英文词条、标准化页面类别、次数和时间。

## 安装

### Chrome

1. 打开 `chrome://extensions`。
2. 开启右上角“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 选择本项目 `github-zh-ui` 文件夹；如果使用 ZIP，请先解压再选择解压目录。
5. 刷新已经打开的 GitHub 标签页。

### Edge

1. 打开 `edge://extensions`。
2. 开启“开发人员模式”。
3. 选择“加载解压缩的扩展”。
4. 选择本项目文件夹并刷新 GitHub 页面。

点击工具栏里的扩展按钮，可以启停中文化、悬停英文和漏译审计，也可以重新扫描、导出或清空漏译报告。

源码修改后，在扩展管理页点击重新加载，再刷新 GitHub。源码目录和旧 ZIP 解压目录可能同时存在，验收时应确认加载的是本次修改后的目录。

## 隐私与权限

扩展只申请：

- `https://github.com/*`：在 GitHub 页面运行固定界面翻译；
- `storage`：保存三个设置开关和本地漏译报告；
- `activeTab`：用户打开弹窗时读取当前 GitHub 标签页的翻译统计。

扩展不申请 Cookie、历史记录、下载或网络拦截权限，不读取密码，不保存完整 URL、查询参数、代码、正文或输入值，也不会上传任何审计信息。审计候选仍采用保守的界面元素白名单；涉及敏感组织的页面可以随时关闭“本地漏译审计”。

## 词库来源和更新

术语优先级为：人工审校的 GitHub 官方术语、当前页面专用词条、公共词条、受限正则模板。社区词库来自 GPL-3.0 项目 [`maboloshi/github-chinese`](https://github.com/maboloshi/github-chinese)，官方术语和结构参考 [`github/docs`](https://github.com/github/docs)、[`primer/react`](https://github.com/primer/react) 与 [`primer/view_components`](https://github.com/primer/view_components)。固定提交和生成时间见 [`generated/sources.json`](generated/sources.json)。

更新来源需要 Node.js 22 或更高版本：

```powershell
npm ci
npm run update:sources
npm test
npm run verify
npm run package
```

`update:sources` 会通过 GitHub API 获取四个上游仓库的最新提交，以社区词库提交 SHA 下载并生成离线词库，同时输出新旧词库计数报告。`package` 要求来源元数据在最近 24 小时内生成，最终可加载目录位于 `dist/github-zh-ui-0.1.0`，ZIP 位于 `dist/github-zh-ui-0.1.0.zip`。

普通源码修复使用 `npm ci`、`npm test` 和 `npm run verify:offline`，无需刷新上游。`verify:offline` 保留权限、离线约束、加载顺序、版本、来源结构和交付文件检查，仅跳过来源年龄；发布用的 `npm run verify` 仍要求 24 小时时效。跨插件维护可在仓库根目录运行 `npm run check`，定位漏译的方法见 [维护指南](../docs/maintenance.md)。

## 覆盖保证

对已收录的固定词条，匹配后必须翻译；对实际访问页面中符合安全白名单、但尚未收录的固定英文，扩展会高亮并加入本地报告。这避免“静默漏译”，但无法声称未来 GitHub 新增页面或当前账号无权访问的企业页面已提前完成翻译。

在 Chrome/Edge 加载本次修改后的目录，登录 GitHub 后按下表记录实际可访问的页面；无权限或未执行的页面单独标记为未验收。

| 场景 | 固定界面检查 | 同页保护对照 |
| --- | --- | --- |
| 首页与仓库首页 | 导航、筛选、代码菜单、分支菜单与工具提示 | 仓库名、用户名、分支名、文件名、README 与代码 |
| Issue 与 Pull Request | 标签页、筛选器、固定操作菜单、确认弹窗 | 标题、正文、评论、代码、标签名称、输入值 |
| Actions | 工作流导航、筛选、运行操作与确认弹窗 | 工作流名、分支名、提交说明、日志与代码 |
| 个人、仓库与组织设置 | 分组导航、固定表单标签、保存/取消/确认按钮 | 姓名、组织/仓库名称、描述、成员内容与输入值 |

每组至少打开一次异步菜单或工具提示，通过 Turbo 站内导航后再检查。已收录且能确认是固定 UI 的文本、`placeholder`、`data-confirm` 及按钮型输入控件的 `value` 应翻译；普通输入值和保护对照保持原样。在站点更新同一控件文案后关闭扩展，核对文本和属性恢复最新原文；重新开启再检查一次。对悬停原文、审计开关和清空/导出，各执行一次操作。

导出的漏译报告只能包含安全固定英文、标准化页面类别、次数和时间，不得出现用户内容或完整 URL。先按维护指南判断是词条、上下文还是动态更新问题，再补对应回归。发布流程和真实页面验收通过前，不把自动测试通过记作全站覆盖完成。

## 开发与许可证

自动测试涵盖词条优先级、路由分类、空白保留、标题、漏译过滤、动态 DOM、用户内容排除和关闭后的英文恢复。

本项目按 GPL-3.0-only 分发。第三方来源和许可说明见 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)。
