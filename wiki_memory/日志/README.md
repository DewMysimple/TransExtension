---
type: knowledge
status: active
kind: process
importance: high
updated: 2026-09-10
topic: trans-extension-work-log
project: trans-extension
affected_projects: [figma-zh-ui, github-zh-ui]
source_logs:
  - "[[日志/2026-09-10-初始化统一工程记忆与Git仓库]]"
supersedes: null
---

# 工作日志说明

本目录是全仓工程记忆的事件层，统一记录根治理和两个插件的实质任务。长期有效的事实、决策、架构和流程必须沉淀到 `当前状态/`、`决策/` 或 `知识/`。

## 文件命名

使用 `YYYY-MM-DD-任务标题.md`；同一天同标题重复时追加 `-02`、`-03` 等后缀。所有类型都直接放在本目录，不创建按类型或插件划分的日志树。

## 项目归属

| `project` | 使用场景 |
| --- | --- |
| `trans-extension` | 根治理、共享流程或多个插件共同受影响 |
| `figma-zh-ui` | 只涉及 Figma 插件 |
| `github-zh-ui` | 只涉及 GitHub 插件 |

跨插件日志使用 `project: trans-extension`，并在 `affected_projects` 列出实际涉及的插件。详细规则见 [[知识/规范/工程记忆项目归属|工程记忆项目归属]]。

## 六类日志 `kind`

| `kind` | 用途 |
| --- | --- |
| `feature` | 新功能、行为变化、重构 |
| `ui` | 纯界面、外观、样式 |
| `bug` | 异常诊断、恢复、修复 |
| `discussion` | 解释、比较、架构讨论、计划 |
| `test` | 测试、审查、检查、验收 |
| `maintenance` | 文档、配置、依赖、清理、迁移 |

混合任务按主要交付物选择一个 `kind`；实现过程中的测试不单独拆成 `test`。

## 内容要求

每篇日志必须包含目标与结果、已确认决策、检查范围、文件变更、验证摘要、问题和下一步、待确认长期记忆。只记录摘要、结论和相对路径，不复制完整聊天、内部推理、密钥、令牌或大段输出。

完成日志使用 `status: archived`，封存后不改写；需要更正时新增日志并链接原文。

## 索引

从仓库根目录运行 `python wiki_memory/工具/memory_lint.py index` 生成 [`MOC_工作日志.md`](./MOC_工作日志.md)。MOC 同时显示项目、影响项目和任务类型，是唯一工作日志索引。
