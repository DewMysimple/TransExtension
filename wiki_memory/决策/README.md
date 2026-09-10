---
type: knowledge
status: active
kind: architecture
importance: high
updated: 2026-09-10
topic: trans-extension-decisions-index
project: trans-extension
affected_projects: [figma-zh-ui, github-zh-ui]
source_logs:
  - "[[日志/2026-09-10-初始化统一工程记忆与Git仓库]]"
supersedes: null
---

# 工程决策

本目录保存已确认且会影响未来工作的工程决策。文件使用 `ADR-NNN-标题.md` 命名。

## 状态

- `proposed`：候选，等待用户确认。
- `active`：当前采用。
- `superseded`：已被新决策替代，仍保留供追溯。
- `deprecated`：不再推荐，但未必有直接替代方案。

## 当前决策

- [[决策/ADR-001-采用根级统一工程记忆|ADR-001：采用根级统一工程记忆]]
- [[决策/ADR-002-完整对话修改必须提交并推送|ADR-002：完整对话修改必须提交并推送]]

新决策必须写明背景、选择、理由、影响、验证方式和来源日志。替代旧决策时填写 `supersedes`，不得删除旧文件。
