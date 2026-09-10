---
type: log
status: archived
kind: maintenance
importance: high
updated: 2026-09-11
topic: trans-extension-memory-directory-layout
project: trans-extension
affected_projects: [figma-zh-ui, github-zh-ui]
source_logs: []
supersedes: null
---

# 2026-09-11｜将工程记忆收拢至 wiki_memory

- 时间：2026-09-11（北京时间）
- 类型：`maintenance`
- 项目：`trans-extension`
- 状态：`完成`
- 目标：将工程记忆组件从仓库根层散列目录收拢到 `wiki_memory/`，保持根项目治理入口和插件目录边界清晰。
- 日志索引：[[日志/MOC_工作日志|工作日志 MOC]]

## 已确认的决策

- 根层只保留总项目 `README.md`、`AGENTS.md`、Git 配置、两个插件目录和 `wiki_memory/` 记忆目录。
- `wiki_memory/` 集中保存 `AGENTS.md`、`README.md`、`llm-wiki.md`、当前状态、决策、知识、日志、模板和检查工具。
- 工程记忆仍然只有一套；两个插件不建立自己的记忆目录。

## 检查与操作

- 将原根层记忆目录移动到 `wiki_memory/`，没有删除任何历史页面。
- 新增 `wiki_memory/README.md` 与 `wiki_memory/AGENTS.md`，把记忆 Schema 与维护流程放在记忆组件目录内。
- 更新根 README、根 AGENTS、插件局部 AGENTS、状态页、决策页、知识页和工具说明中的路径。
- 适配 `memory_lint.py`：默认根为 `wiki_memory/`，允许受控链接指向同一仓库的插件文档，并继续只把记忆页面纳入索引与孤儿检查。

## 文件变更

- 新增 `wiki_memory/` 目录及其全部工程记忆组件。
- 根层不再直接包含 `当前状态/`、`决策/`、`知识/`、`日志/`、`模板/`、`工具/` 或 `llm-wiki.md`。
- 两个插件 README 保持原样；插件代码、配置、生成词库和来源元数据未改动。

## 测试与验证

- `python wiki_memory/工具/memory_lint.py index` 成功刷新 MOC。
- `python wiki_memory/工具/memory_lint.py check` 通过，检查 24 个上下文页面。
- 新路径下的相对链接、插件文档链接和 MOC 日志集合均通过检查。
- Figma 与 GitHub 插件的 `npm test` 均 6/6 通过；本轮未修改插件运行时代码，因此未重复运行来源时效门槛相关的 `verify`。

## 待确认长期记忆

- 无；用户已明确要求工程记忆组件位于 `wiki_memory/`，本轮直接按确认要求落地。

## 问题、结果与下一步

- 结果：根目录职责更清晰，工程记忆成为可整体浏览、复制和维护的独立组件目录。
- 遗留问题：无。
- 下一步：后续记忆页面和日志继续写入 `wiki_memory/`，并从仓库根执行其检查工具。
