# TransExtension 工程记忆

这是 TransExtension 的集中式工程记忆目录。它根据“工程记忆构建”框架，把当前有效事实、已确认决策、稳定知识和工作历史保存为可审计的 Markdown 页面。

## 目录

```text
wiki_memory/
├── AGENTS.md                 # 记忆维护协议
├── README.md                 # 本入口
├── llm-wiki.md               # LLM Wiki 理念说明
├── 当前状态/                 # 当前有效事实与约束
├── 决策/                     # ADR 与决策索引
├── 知识/                     # 模块、流程、规范与运维知识
├── 日志/                     # 全仓唯一的追加式工作日志
├── 模板/                     # 新页面模板
└── 工具/memory_lint.py       # 索引与健康检查
```

根项目的共享工程规则位于 [`../AGENTS.md`](../AGENTS.md)，项目总览位于 [`../README.md`](../README.md)。本目录的 `AGENTS.md` 只负责记忆页面的 Schema、读取、写入和检查约定。

## 使用方式

每次会话先读取根 AGENTS，再读取 `当前状态/项目概览.md`、`系统架构.md`、`当前约束.md` 和 `当前待办.md`；需要追溯时再按项目读取相关决策、知识和最近日志。

所有页面用 Front Matter 的 `project` 标记主归属：

- `trans-extension`：根治理、公共事实或跨插件任务；
- `figma-zh-ui`：只影响 Figma 插件；
- `github-zh-ui`：只影响 GitHub 插件。

跨插件页面以 `project: trans-extension` 为主，并使用 `affected_projects` 列出实际受影响的插件。插件目录不创建第二套记忆树。

## 工具

从仓库根目录执行：

```powershell
python wiki_memory/工具/memory_lint.py index
python wiki_memory/工具/memory_lint.py check
```

`日志/MOC_工作日志.md` 是唯一日志索引；日志按项目、影响项目、类型和日期导航。页面模板在 `模板/`，理论说明在 [`llm-wiki.md`](./llm-wiki.md)。
