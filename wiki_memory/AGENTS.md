# AGENTS.md — 工程记忆维护协议

本文件只约束 `wiki_memory/` 内的记忆页面，继承仓库根 [`../AGENTS.md`](../AGENTS.md)。根规则负责产品边界、插件开发、Git 提交与推送；本文件负责记忆 Schema 和页面维护。

## 记忆模型

- `当前状态/`：当前有效事实，每个 `project + type + topic` 只能有一个 active 版本。
- `决策/`：架构、技术选型和会影响后续工作的工程决策；旧决策保留并标记替代。
- `知识/`：稳定的模块、流程、规范和运维知识。
- `日志/`：一次实质任务的追加式历史；所有项目共用一个物理目录。
- `模板/`：创建新页面时使用，不属于受管页面集合。
- `工具/memory_lint.py`：检查 Schema、链接、项目归属、MOC 完整性并重建日志索引。

## 会话读取顺序

1. 读取仓库根 `../AGENTS.md` 和本文件。
2. 读取 `当前状态/项目概览.md`、`当前状态/系统架构.md`、`当前状态/当前约束.md`、`当前状态/当前待办.md`。
3. 根据任务的 `project` 读取对应的 active 决策和知识页。
4. 只有需要追溯时才读取最近 1–3 篇相关日志。

不要为了“完整”默认读取全部历史；启动记忆包应尽量控制在约 6,000 tokens 内。

## Front Matter Schema

所有 `当前状态/`、`决策/`、`知识/`、`日志/` 页面及 `日志/MOC_工作日志.md` 必须包含：

```yaml
---
type: state | decision | knowledge | log | moc
status: active | proposed | deprecated | superseded | archived
kind: feature | ui | bug | discussion | test | maintenance | architecture | process | module | operations
importance: high | medium | low
updated: YYYY-MM-DD
topic: stable-kebab-case-topic
project: trans-extension | figma-zh-ui | github-zh-ui
affected_projects: []
source_logs: []
supersedes: null
---
```

### 项目归属

- 单插件任务使用对应插件 ID，且 `affected_projects: []`。
- 根治理、共享规范或同时影响多个插件的任务使用 `project: trans-extension`，并列出实际受影响的插件。
- `affected_projects` 不得重复主项目、不得重复自身、不得出现未知 ID。
- `topic` 应使用带项目语义的稳定 kebab-case，例如 `figma-zh-ui-module`。

### 页面关系

- `source_logs` 只能链接 `日志/` 下的工作日志页面。
- `supersedes` 只能链接同一 `type`、同一 `project` 的旧记忆页；新页面 active 时旧页必须标为 `superseded` 或 `deprecated`。
- 不删除旧日志或旧决策；需要更正时新建页面并建立关系。

## 写入与同步

完成实质任务后执行“记忆同步”：

1. 新建 `日志/YYYY-MM-DD-任务标题.md`；同日重名追加 `-02`、`-03`。
2. 记录目标、确认的决策、检查范围、文件变更、测试摘要、结果、遗留问题和下一步。
3. 只有用户已确认且会影响未来工作的事实，才提升到 active 状态、决策或知识页；候选内容留在日志的“待确认长期记忆”。
4. 从仓库根运行 `python wiki_memory/工具/memory_lint.py index`，再运行 `python wiki_memory/工具/memory_lint.py check`。
5. 将记忆同步与本轮代码/文档修改一起提交，遵守根 AGENTS 的推送闭环。

日志使用 `kind: feature | ui | bug | discussion | test | maintenance`；长期页面还可使用 `architecture`、`process`、`module`、`operations`。日志完成后使用 `status: archived`，封存后不改写。

## 索引与健康检查

- `日志/MOC_工作日志.md` 是唯一工作日志 MOC，不能建立按插件或类型复制的 MOC。
- `index` 会按日期、同标题序号、项目和类型重建日志表格。
- `check` 会检查必填字段、目录/type、合法项目、来源日志、替代关系、链接、孤儿页、active 主题唯一性和 MOC 是否陈旧。
- 原始代码、插件 README、配置和来源元数据优先于记忆页面；记忆只保存结论、关系和相对路径。
- 不记录完整聊天、内部推理、隐藏上下文、密钥、令牌、完整私人 URL、用户正文或大段命令输出。
