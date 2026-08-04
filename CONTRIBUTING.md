# 参与贡献

感谢你对 NarraCat 的兴趣！

## 开发环境

- macOS（Apple Silicon）、Node ^22.12、[bun](https://bun.sh)
- 安装依赖：`bun install --no-cache`（所有 bun 命令都带 `--no-cache`）
- 本地运行：`bun --no-cache run dev`
- 验证：`bun --no-cache run typecheck && bun --no-cache run test`

## 工程约定

- 主进程是纯 ESM；React 只用函数组件 + hooks，不写 class
- 渲染进程路由用 HashRouter（file:// 场景），不要换 BrowserRouter
- 架构分层由 `scripts/check-architecture.mjs` 硬校验，提交前请确保通过
- 目录职责见 [ARCHITECTURE.md](./ARCHITECTURE.md)

## 提交 PR

1. Fork 并从 `main` 拉分支
2. 保持改动聚焦、附测试；提交信息用祈使句
3. 首次贡献需签署 CLA（机器人会在 PR 里引导，全文见 [docs/CLA.md](./docs/CLA.md)）
4. CI 全绿后等待 review

## 报告问题

- Bug/功能请走 issue 模板；使用求助与讨论请去 Discussions
- **提交任何内容前请脱敏：不要粘贴你的小说正文、API key 或含个人路径的完整日志**
