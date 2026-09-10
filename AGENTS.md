# AGENTS.md — TransExtension 工程与记忆维护协议

本文件适用于整个仓库。进入 `figma-zh-ui/` 或 `github-zh-ui/` 工作时，还必须读取并遵守该目录的 `AGENTS.md`；局部规则只补充目标站点差异，不取消本文件的共享约束。

`AGENTS.md` 是 Codex 与本工程记忆框架采用的标准自动发现文件名。不要另建易与其分叉的 `AGENT.md`。

## 会话开始时

按以下顺序建立上下文，默认不要通读全部历史：

1. 读取本文件。
2. 读取 `当前状态/项目概览.md`、`当前状态/系统架构.md`、`当前状态/当前约束.md`、`当前状态/当前待办.md`。
3. 若任务位于插件目录，读取该插件的 `AGENTS.md`、`README.md`、`package.json` 与 `manifest.json`。
4. 读取与任务相关的 active 决策和知识页。
5. 只有追溯原因时才读取最近 1–3 篇相关日志或更早历史。

启动上下文应尽量控制在约 6,000 tokens 内。

## 仓库边界

- `figma-zh-ui/` 与 `github-zh-ui/` 是两个可独立安装、测试和打包的 Manifest V3 扩展。
- 两个插件保留各自的 `README.md`、许可证、第三方声明、包配置和版本号；根 README 不替代子 README。
- 工程记忆只在仓库根的 `当前状态/`、`决策/`、`知识/`、`日志/` 中维护，不在插件目录复制。
- `generated/dictionary.js` 与 `generated/sources.json` 是应版本化的生成输入；`dist/`、`node_modules/`、更新报告和临时文件不得提交。
- 原始代码、配置、子项目 README 与来源元数据是事实来源。记忆页只保存结论、关系和相对路径，不复制大段原文。

## 共享产品原则

- 只翻译目标站点中可以确认的固定界面文字；无法确认时保留原文。
- 严格保护用户生成内容、名称、正文、评论、代码、设计内容和输入区域；具体边界服从子项目规则。
- 扩展运行时代码不得请求远程翻译、脚本或词库。
- 权限保持最小化。新增 host 或高风险浏览器权限前必须说明理由、更新文档并获得用户确认。
- 更改翻译核心、DOM 排除规则、权限、数据收集或关闭恢复逻辑时，必须增加或更新相应测试。
- 不记录或提交密钥、令牌、账号内容、完整私人 URL、用户正文或大段命令输出。

## 开发与验证

- Node.js 最低版本为 22；可复现安装优先使用 `npm ci`。
- 单插件改动至少运行该插件的 `npm test`；公共规则或跨插件改动运行两个插件的测试。
- `npm run verify` 同时检查权限、离线约束、交付文件和来源元数据时效。若仅因 24 小时来源时效失败，应如实记录，不为无关任务擅自刷新上游。
- 只有词库更新或发布任务才默认执行 `npm run update:sources` 和 `npm run package`；生成后审查词库、来源、许可证和第三方声明的 diff。
- 涉及真实页面选择器、异步导航、用户内容排除或关闭恢复的改动，还需按子 README 做 Chrome/Edge 人工冒烟验收。
- 不修改与当前任务无关的用户变更，不使用破坏性 Git 命令清理工作区。

## 工程记忆协议

### 记忆模型

- `当前状态/`：当前有效项目事实，每个主题只有一个明确 active 版本。
- `决策/`：架构、技术选型和影响后续工作的工程决策。
- `知识/`：稳定的模块、流程、规范和运维知识。
- `日志/`：一次实质任务的追加式历史；不是当前事实的唯一来源。
- `AGENTS.md`：程序性记忆，规定 Agent 如何维护上述内容。

### Front Matter

所有受管长期页面、MOC 和日志必须包含：

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

归属规则：

- 只涉及一个插件时，`project` 使用对应插件 ID。
- 根治理、共享规范或多个插件共同受影响时，使用 `project: trans-extension`。
- `affected_projects` 只填写除主项目外实际受影响的项目 ID；没有则为 `[]`。
- `topic` 使用稳定且带项目语义的 kebab-case 名称，避免同名主题碰撞。

日志的 `kind` 只能取 `feature`、`ui`、`bug`、`discussion`、`test`、`maintenance` 之一；长期页面还可使用 `architecture`、`process`、`module`、`operations`。

### 写入规则

完成实质任务后自动执行“记忆同步”：

1. 新建 `日志/YYYY-MM-DD-任务标题.md`；同名时追加 `-02`、`-03`。
2. 记录目标、已确认决策、检查范围、文件变更、验证摘要、结果、遗留问题和下一步。
3. 只把用户已确认且影响未来工作的结论提升到 `当前状态/`、`决策/` 或 `知识/`；未确认候选只留在日志“待确认长期记忆”。
4. 新结论替代旧结论时，将旧页面标为 `superseded` 或 `deprecated`，填写 `supersedes` 并保留旧页。
5. 运行 `python 工具/memory_lint.py index`，再运行 `python 工具/memory_lint.py check`。

日志封存后不改写；需更正时新建日志并链接原日志。禁止记录完整聊天、内部推理、隐藏上下文、密钥、令牌或大段输出。

### 固定操作

- `记忆同步`：生成日志、提出长期记忆候选、刷新索引并检查。
- `记忆检索 <关键词>`：先查当前状态和日志 MOC，再按需查知识、决策与历史日志。
- `记忆体检`：运行 lint，报告缺字段、非法归属、断链、重复 active 主题与孤儿页。
- `记忆压缩`：把重复历史归纳到长期页面，不删除原始日志。

## 完整对话的 Git 闭环

用户已明确要求：每次完整对话只要产生仓库文件修改，就必须提交并推送。

结束前依次执行：

1. 完成与任务相称的测试和检查。
2. 执行记忆同步，并检查最终 diff 中没有秘密、依赖目录或无关文件。
3. 将本轮相关修改作为一个语义清晰的提交提交；不要创建空提交。
4. 推送当前分支到 `origin`。首次推送使用上游跟踪分支。
5. 最终答复报告提交、推送和验证结果；若推送因认证、网络或远程冲突失败，明确报告阻塞，不能声称已完成。
