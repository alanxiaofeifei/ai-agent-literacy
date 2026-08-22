# AI 与 AI Agent 互动知识航图

[![Deploy bilingual course to GitHub Pages](https://github.com/alanxiaofeifei/ai-agent-literacy/actions/workflows/pages.yml/badge.svg)](https://github.com/alanxiaofeifei/ai-agent-literacy/actions/workflows/pages.yml)

[English README](README_EN.md) · [在线课程](https://alanxiaofeifei.github.io/ai-agent-literacy/) · [English Edition](https://alanxiaofeifei.github.io/ai-agent-literacy/en/) · [季度更新政策](QUARTERLY_UPDATE_POLICY.md)

一个开源、双语、单文件可离线运行的生成式 AI 与 AI Agent 互动科普课程。

## 面向谁

- **零 IT 基础学习者**：从白话解释、生活类比和安全边界开始。
- **有通用 IT 技术基础、但不熟悉 AI 的学习者**：以软件、系统、网络、云、数据、安全、自动化和运维等通用 IT 场景理解 AI Agent。

## 内容规模

| 模块 | 数量 |
|---|---:|
| 核心概念 | 64 |
| AI发展时间轴 | 33 |
| 主流产品/框架 | 56 |
| Coding/Token Plan 方案组 | 8 |
| Hermes学习模块 | 25 |
| Hermes/OpenClaw比较维度 | 14 |
| 测验与情境挑战 | 24 |
| 官方/YouTube/Bilibili拓展资源 | 43 |
| 官方来源台账 | 86 |

## 内容

- 2022-11-30 ChatGPT 发布至今的重要时间轴
- LLM、Token、上下文窗口、RAG、Embedding、Tool Calling、Memory
- AI Agent、Agent Loop、MCP、Agent Skills、插件、Harness Engineering、Loop Engineering
- API、CLI、浏览器自动化、CDP、无障碍树和电脑控制
- 国内外主流模型、聊天产品、Coding Agent、个人 Agent 与开发框架
- Hermes Agent 与 OpenClaw 的条件化、公平比较
- 国内 Coding/Token Plan 的订阅与 API 区别、额度窗口和时效提醒
- 测验、情境挑战、Memory 沙盘、权限决策器、XP、徽章和结业证书
- 官方课程、YouTube 与 Bilibili 拓展学习资源

## 双语与离线

- 中文：`index.html`
- English: `en/index.html`
- 两个版本都不依赖 CDN、远程字体、远程 JavaScript 或远程 CSS。
- 官方来源和拓展学习链接只在用户主动点击时联网。

## 知识更新

- **当前知识核实日期：2026-08-22**
- **复核频率：每季度一次**（1月、4月、7月、10月）
- 优先使用官方规范、厂商文档、产品/价格页和一手工程文章。
- 新增术语和资源会先规范化名称与 URL，并与既有条目去重。
- 价格、额度、模型可用性和权限规则必须标注核实日期；无法从官方来源确认时不猜测。

详见 [季度知识更新政策](QUARTERLY_UPDATE_POLICY.md)。

## 本地使用

直接双击：

```text
index.html
```

也可以运行一个静态服务器：

```bash
python3 -m http.server 8000
```

然后访问：

```text
http://127.0.0.1:8000/
```

## 验证

```bash
python3 scripts/validate_public_site.py
```

验证范围包括：中英文入口、内联运行依赖、关键内容、知识日期、语言切换、来源链接是否存在、敏感信息模式和基础结构。外链在线可达性使用 `python3 scripts/check_urls.py index.html` 与英文页对应命令单独检查。

## 贡献

欢迎通过 Issue 或 Pull Request 提交：

- 新的官方学习资料
- 新术语或术语更新
- 产品/订阅变化
- 翻译修正
- 无障碍、交互或移动端改进

提交时请提供一手来源、核实日期和变更理由；不要提交真实 API Key、Cookie、Token、密码、账号截图或私人路径。

## 免责声明

本项目用于教育与安全科普，不构成产品采购、财务、法律或信息安全承诺。AI 产品、价格、额度和能力变化很快，请以官方页面和控制台为准。

## 许可证

[MIT License](LICENSE)
