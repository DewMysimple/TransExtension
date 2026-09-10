---
type: knowledge
status: active
kind: module
importance: high
updated: 2026-09-10
topic: github-zh-ui-module
project: github-zh-ui
affected_projects: []
source_logs:
  - "[[日志/2026-09-10-初始化统一工程记忆与Git仓库]]"
supersedes: null
---

# github-zh-ui 模块

## 一句话结论

面向 `github.com` 的离线 Manifest V3 简体中文界面扩展，在翻译固定控件的同时严格跳过代码和用户内容。

## 入口与结构

| 路径 | 职责 |
| --- | --- |
| `github-zh-ui/manifest.json` | 权限、后台、弹窗和内容脚本加载顺序 |
| `github-zh-ui/src/core.js` | 路由、词条优先级、文本处理、保护与候选过滤 |
| `github-zh-ui/src/content.js` | Turbo/动态 DOM、翻译、恢复与漏译审计 |
| `github-zh-ui/src/official-overrides.js` | 人工审校的 GitHub 官方术语 |
| `github-zh-ui/src/background.js` | 设置和本地审计数据 |
| `github-zh-ui/src/popup.*` | 设置、统计、导出与清理 UI |
| `github-zh-ui/generated/` | 需要版本化的离线词库和来源元数据 |
| `github-zh-ui/tests/` | 核心与 jsdom 内容脚本测试 |

## 关键边界

- 目标域只允许 `https://github.com/*`。
- 必须保护代码、README、Issue/PR 正文、评论、文件名、仓库名、用户名和输入内容。
- 词库来源包括 `maboloshi/github-chinese`、`github/docs`、`primer/react` 与 `primer/view_components`；人工术语在 `src/official-overrides.js` 维护。
- 内容脚本加载顺序为 dictionary → official overrides → core → content。
- `generated/dictionary.js` 和 `generated/sources.json` 由更新脚本生成，不手工编辑；`dist/` 不提交。

## 开发入口

- 用户与安装说明：[`github-zh-ui/README.md`](../../../github-zh-ui/README.md)
- 局部工程规则：[`github-zh-ui/AGENTS.md`](../../../github-zh-ui/AGENTS.md)
- 通用验证流程：[[知识/流程/开发验证与发布|开发验证与发布]]

## 常见陷阱

- 页面范围或候选过滤过宽会误翻译代码与正文；路由和内容保护需要同时验证。
- `npm run verify` 要求来源元数据不超过 24 小时；不要为普通源码改动无意义刷新上游。
- 更新来源会改变大词库和许可证材料，必须审查词条规模、来源 SHA 和第三方声明。
