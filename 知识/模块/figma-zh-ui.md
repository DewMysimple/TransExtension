---
type: knowledge
status: active
kind: module
importance: high
updated: 2026-09-10
topic: figma-zh-ui-module
project: figma-zh-ui
affected_projects: []
source_logs:
  - "[[日志/2026-09-10-初始化统一工程记忆与Git仓库]]"
supersedes: null
---

# figma-zh-ui 模块

## 一句话结论

面向 `www.figma.com` 的离线 Manifest V3 简体中文界面扩展，在翻译固定控件的同时优先保护设计和用户内容。

## 入口与结构

| 路径 | 职责 |
| --- | --- |
| `figma-zh-ui/manifest.json` | 权限、后台、弹窗和内容脚本加载顺序 |
| `figma-zh-ui/src/core.js` | 路由、翻译优先级、文本处理与保护判断 |
| `figma-zh-ui/src/content.js` | 动态 DOM 扫描、翻译、恢复与漏译审计 |
| `figma-zh-ui/src/official-overrides.js` | 人工审校术语与页面覆盖 |
| `figma-zh-ui/src/background.js` | 设置和本地审计数据 |
| `figma-zh-ui/src/popup.*` | 设置、统计、导出与清理 UI |
| `figma-zh-ui/generated/` | 需要版本化的离线词库和来源元数据 |
| `figma-zh-ui/tests/` | 核心与 jsdom 内容脚本测试 |

## 关键边界

- 目标域只允许 `https://www.figma.com/*`。
- 必须保护文件、项目、团队、图层、变量、画布/设计文字、评论和输入区域。
- 词库基于固定提交的 `Figma-Cool/figmaCN`，人工术语在 `src/official-overrides.js` 维护。
- 内容脚本加载顺序为 dictionary → official overrides → core → content。
- `generated/dictionary.js` 和 `generated/sources.json` 由更新脚本生成，不手工编辑；`dist/` 不提交。

## 开发入口

- 用户与安装说明：[`figma-zh-ui/README.md`](../../figma-zh-ui/README.md)
- 局部工程规则：[`figma-zh-ui/AGENTS.md`](../../figma-zh-ui/AGENTS.md)
- 通用验证流程：[[知识/流程/开发验证与发布|开发验证与发布]]

## 常见陷阱

- Figma 类名和 DOM 会持续变化，宽泛选择器容易误伤画布或图层内容。
- `npm run verify` 要求来源元数据不超过 24 小时；不要为普通源码改动无意义刷新上游。
- `update:sources` 会更新生成词库、来源信息、报告及许可证，需要逐项审查 diff。
