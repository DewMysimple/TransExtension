# TransExtension

TransExtension 是面向特定网站的简体中文界面翻译扩展集合。仓库统一管理共享工程规则、工程记忆与 Git 历史；每个插件仍保留独立的安装、权限、词库与验收文档。

## 插件

| 插件 | 目标网站 | 当前版本 | 说明 |
| --- | --- | --- | --- |
| [`figma-zh-ui`](./figma-zh-ui/) | `www.figma.com` | `0.1.1` | [Figma 插件 README](./figma-zh-ui/README.md) |
| [`github-zh-ui`](./github-zh-ui/) | `github.com` | `0.1.0` | [GitHub 插件 README](./github-zh-ui/README.md) |

两个插件均为 Chrome/Edge Manifest V3 扩展，词库随扩展打包，运行时不调用翻译服务。它们只翻译可确认的固定界面文字，并保守保护设计内容、代码、正文、评论、名称和用户输入。

## 仓库结构

```text
TransExtension/
├── AGENTS.md                 # 全仓 Agent、工程记忆与交付规则
├── README.md                 # 总项目入口
├── package.json              # 双插件统一质量入口，仅含开发测试依赖
├── scripts/                  # 仅用于开发的跨插件检查编排
├── tests/                    # 两个独立验证器的共享契约回归
├── docs/maintenance.md       # 漏译定位、修改边界与回归方法
├── figma-zh-ui/              # Figma 翻译插件及其局部 AGENTS/README
├── github-zh-ui/             # GitHub 翻译插件及其局部 AGENTS/README
└── wiki_memory/              # 集中式工程记忆组件
    ├── AGENTS.md             # 记忆维护协议
    ├── README.md             # 记忆系统入口
    ├── 当前状态/             # 当前有效事实
    ├── 决策/                 # 已确认工程决策（ADR）
    ├── 知识/                 # 模块、流程、规范与运维知识
    ├── 日志/                 # 全仓统一的追加式工作日志
    ├── 模板/                 # 工程记忆页面模板
    └── 工具/memory_lint.py   # 记忆检查与日志索引工具
```

子项目的 `AGENTS.md` 继承根规则，只补充目标站点特有的保护边界、文件职责与验证要求；工程记忆不在子项目内重复建设。

## 开发与验证

需要 Node.js 22 或更高版本，以及 Python 3（工程记忆检查使用标准库）。在仓库根目录执行：

```powershell
npm ci
npm ci --prefix figma-zh-ui
npm ci --prefix github-zh-ui
npm run check
```

根目录的 Playwright 依赖只用于浏览器测试；两个插件仍分别使用自己的锁文件和 `node_modules`，独立安装或打包不依赖根目录。`check` 依次执行门禁回归、两个插件的 `npm test`、`verify:offline` 和工程记忆检查；任何一步失败都会返回非零状态，并继续展示其他检查结果。GitHub Actions 在 Windows 和 Linux 的 Node.js 22 环境运行相同入口，并额外在 Linux 验证真实 MV3 扩展加载。

日常只修改一个插件时，可进入其目录运行 `npm test` 和 `npm run verify:offline`。离线静态验证检查最小权限、主机范围、内容脚本加载顺序、版本一致性、交付文件、来源结构、词库规模、JavaScript 语法和常见联网调用；不会下载或改写词库。静态扫描是回归门禁，不能替代代码审查和浏览器验收。

`npm run verify` 保留发布要求，额外检查 `generated/sources.json` 在最近 24 小时内生成。普通源码或文档改动不应只为通过该时效门槛而刷新上游；更新词库或准备发布时，在对应插件目录按以下顺序执行：

```powershell
npm run update:sources
npm test
npm run verify
npm run package
```

漏译问题应先判断是缺词、上下文保护、文本结构还是动态生命周期问题，再选择修改位置；具体流程与回归要求见 [维护指南](./docs/maintenance.md)。完整安装、权限与人工验收步骤见各插件自己的 README。自动检查通过不代表真实页面已全部覆盖或已通过发布验收。

验证实际扩展加载、后台、存储、消息和弹窗导出时，在根目录运行：

```powershell
npx playwright install --no-shell chromium
npm run test:browser
```

这组测试使用独立临时浏览器配置，加载两个插件原始 manifest，真实执行扩展 API，并将目标域页面拦截为合成界面；不读取日常浏览器配置，也不需要网站账号。它能验证安装与模块连接，但不能证明登录后站点的所有 DOM、工具栏弹窗定位或 `activeTab` 用户手势行为；这些仍须按子项目 README 人工验收。使用测试 Chromium 是因为 [当前 Chrome/Edge 不支持测试所需的自动侧载参数](https://playwright.dev/docs/chrome-extensions)。

本机装有 Chrome 或 Edge 时，也可以运行较轻量的 DOM 合成冒烟，参数使用浏览器可执行文件的绝对路径，例如：

```powershell
node scripts/browser-smoke.mjs "C:\Program Files\Google\Chrome\Application\chrome.exe"
```

也可将参数替换为本机 `msedge.exe` 的绝对路径。该脚本在本地合成页面运行当前词库和内容脚本，使用 Chrome API 替身，不依赖登录会话、不加载已安装扩展，也不进入默认检查或 CI。真实 Figma/GitHub 页面仍须按子项目 README 人工验收；未登录或无法访问的场景应记录为未验收。

## 工程记忆

工程记忆集中维护在根目录的 `wiki_memory/` 下，历史日志只有一个物理目录。每个受管 Markdown 页都通过 Front Matter 的 `project` 标识归属：

- `trans-extension`：根治理、共享流程或跨插件任务；
- `figma-zh-ui`：只影响 Figma 插件；
- `github-zh-ui`：只影响 GitHub 插件。

跨插件任务以 `project: trans-extension` 记录，并在 `affected_projects` 中列出受影响插件。常用入口：

- [工程记忆入口](./wiki_memory/README.md)
- [项目概览](./wiki_memory/当前状态/项目概览.md)
- [系统架构](./wiki_memory/当前状态/系统架构.md)
- [当前约束](./wiki_memory/当前状态/当前约束.md)
- [工作日志索引](./wiki_memory/日志/MOC_工作日志.md)
- [工程决策](./wiki_memory/决策/README.md)
- [记忆维护协议](./AGENTS.md#工程记忆协议)

检查或刷新工程记忆：

```powershell
python wiki_memory/工具/memory_lint.py index
python wiki_memory/工具/memory_lint.py check
```

## Git 交付约束

一次完整对话只要产生仓库文件修改，就必须在结束前完成相关验证、记忆同步、Git 提交，并推送当前分支到 `origin`。纯问答或只读检查没有文件变化时不创建空提交。完整规则见 [`AGENTS.md`](./AGENTS.md)。

## 许可证

各插件的代码、词库来源和第三方声明以其目录内的 `LICENSE` 与 `THIRD_PARTY_NOTICES.md` 为准。
