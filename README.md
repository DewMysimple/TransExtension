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
├── figma-zh-ui/              # Figma 翻译插件及其局部 AGENTS/README
├── github-zh-ui/             # GitHub 翻译插件及其局部 AGENTS/README
├── 当前状态/                 # 当前有效事实
├── 决策/                     # 已确认工程决策（ADR）
├── 知识/                     # 模块、流程、规范与运维知识
├── 日志/                     # 全仓统一的追加式工作日志
├── 模板/                     # 工程记忆页面模板
└── 工具/memory_lint.py       # 记忆检查与日志索引工具
```

子项目的 `AGENTS.md` 继承根规则，只补充目标站点特有的保护边界、文件职责与验证要求；工程记忆不在子项目内重复建设。

## 开发与验证

需要 Node.js 22 或更高版本。进入对应插件目录后执行：

```powershell
npm ci
npm test
npm run verify
```

`verify` 要求 `generated/sources.json` 在最近 24 小时内生成。普通源码或文档改动不应只为通过该时效门槛而刷新上游；更新词库或准备发布时，按以下顺序执行：

```powershell
npm run update:sources
npm test
npm run verify
npm run package
```

完整安装、权限与人工验收步骤见各插件自己的 README。

## 工程记忆

工程记忆直接维护在仓库根层，历史日志只有一个物理目录。每个受管 Markdown 页都通过 Front Matter 的 `project` 标识归属：

- `trans-extension`：根治理、共享流程或跨插件任务；
- `figma-zh-ui`：只影响 Figma 插件；
- `github-zh-ui`：只影响 GitHub 插件。

跨插件任务以 `project: trans-extension` 记录，并在 `affected_projects` 中列出受影响插件。常用入口：

- [项目概览](./当前状态/项目概览.md)
- [系统架构](./当前状态/系统架构.md)
- [当前约束](./当前状态/当前约束.md)
- [工作日志索引](./日志/MOC_工作日志.md)
- [工程决策](./决策/README.md)
- [记忆维护协议](./AGENTS.md#工程记忆协议)

检查或刷新工程记忆：

```powershell
python 工具/memory_lint.py index
python 工具/memory_lint.py check
```

## Git 交付约束

一次完整对话只要产生仓库文件修改，就必须在结束前完成相关验证、记忆同步、Git 提交，并推送当前分支到 `origin`。纯问答或只读检查没有文件变化时不创建空提交。完整规则见 [`AGENTS.md`](./AGENTS.md)。

## 许可证

各插件的代码、词库来源和第三方声明以其目录内的 `LICENSE` 与 `THIRD_PARTY_NOTICES.md` 为准。
