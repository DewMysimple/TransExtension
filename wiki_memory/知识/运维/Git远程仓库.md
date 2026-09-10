---
type: knowledge
status: active
kind: operations
importance: high
updated: 2026-09-10
topic: trans-extension-git-remote
project: trans-extension
affected_projects: []
source_logs:
  - "[[日志/2026-09-10-初始化统一工程记忆与Git仓库]]"
supersedes: null
---

# Git 远程仓库

## 当前配置

- 根仓库默认分支：`main`。
- 远程名称：`origin`。
- 远程地址：`https://github.com/DewMysimple/TransExtension.git`。
- 两个插件不是嵌套 Git 仓库，它们作为根仓库的普通目录统一版本化。

## 版本化边界

- 跟踪源码、测试、配置、文档、lockfile、`generated/dictionary.js` 与 `generated/sources.json`。
- 忽略 `node_modules/`、`dist/`、coverage、更新报告、临时文件、缓存和本机环境文件。
- 不在记忆或提交中保存凭据；认证由本机 Git 凭据机制处理。

## 每轮检查

```powershell
git status --short --branch
git diff --check
git log -1 --oneline
git ls-remote origin refs/heads/main
```

推送策略见 [[知识/流程/完整对话交付闭环|完整对话交付闭环]]。
