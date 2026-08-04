<div align="center">

# NarraCat 🐈‍⬛

**面向中国网文作者的 AI 共创桌面应用**

*NarraCat is an AI-powered desktop writing studio for Chinese web-novel authors — plan, draft, and manage million-word serials with an agentic creative engine that keeps long-range plot memory.*

[![CI](https://github.com/pantsbang-yannik/narracat-novel-agent/actions/workflows/app-ci.yml/badge.svg)](https://github.com/pantsbang-yannik/narracat-novel-agent/actions)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![Release](https://img.shields.io/github/v/release/pantsbang-yannik/narracat-novel-agent)](https://github.com/pantsbang-yannik/narracat-novel-agent/releases)

</div>

<!-- screenshots:start 由演示小说素材任务填充 -->
<!-- screenshots:end -->

## 三步开始写

1. **下载安装**：到 [Releases](https://github.com/pantsbang-yannik/narracat-novel-agent/releases) 下载最新 DMG（目前仅支持 **macOS Apple Silicon**；其他平台暂无时间表，欢迎关注）
2. **配置模型**：NarraCat 采用 BYOK（自带 API Key）。推荐 DeepSeek，几分钟即可申请，费用与配置见 [FAQ](./docs/faq.md)
3. **开一本书**：新建小说 → 立项卡定题材与金手指 → 让 Agent 铺大纲、写第一章

## 它能做什么

- 📖 **超长篇底座**：立项 → 大纲 → 章纲 → 成稿的全流程产品化，角色/伏笔/世界观结构化管理
- 🧠 **长程记忆**：内置 NovelMemory 记忆库，写到第 100 章仍记得第 3 章埋的钩子
- ✍️ **创作引擎全开源**：写作 prompt 工程（agents/skills/commands）就在 `agent-core/` 里，欢迎研究与改进
- 🧩 **能力包**：手写卡、从书学写法、作家向导，把你的写作偏好装进引擎
- 💬 **角色聊天**：和你笔下的角色唠个嗑，TA 记得自己的经历

## AI 生成内容声明

- 你用 NarraCat 生成的内容，权利与责任归你
- 各网文平台对 AI 辅助创作有各自政策，投稿前请自行确认目标平台规则

## 参与

- 使用求助/闲聊 → [Discussions](https://github.com/pantsbang-yannik/narracat-novel-agent/discussions)
- Bug/功能建议 → [Issues](https://github.com/pantsbang-yannik/narracat-novel-agent/issues)（**请勿粘贴小说正文与 API Key**）
- 参与开发 → [CONTRIBUTING.md](./CONTRIBUTING.md) · 架构导览 → [ARCHITECTURE.md](./ARCHITECTURE.md)
- 安全问题 → [SECURITY.md](./SECURITY.md)

## License

[AGPL-3.0](./LICENSE) — 你可以自由使用、修改、分发；基于本项目的分发或网络服务须以同等条款开源。
