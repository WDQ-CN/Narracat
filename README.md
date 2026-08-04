# NarraCat-app

面向中国网文作者的 AI 共创桌面应用。NarraCat-app 内部维护 NarraCat Agent Core：App orchestration layer 负责 Library、Workbench、Settings、IPC、Agent 对话和产品化 Agent 入口；Agent Core 负责小说创作命令、运行适配器和项目文件合同。

## 当前状态

当前阶段、已完成事项、下一步和阻塞记录在 [`docs/agents/progress.md`](docs/agents/progress.md)。README 不维护阶段看板，避免和 OPS 文档漂移。

## 开发

本项目开发命令需要 Node.js `^22.12.0`。如果使用 nvm：

```bash
nvm install 22
nvm use 22
```

```bash
bun install --no-cache

bun --no-cache run dev
bun --no-cache run typecheck
bun --no-cache run test
bun --no-cache run check:design
bun --no-cache run build
```

根据改动类型选择最小验证集合，见 [`docs/agents/verification.md`](docs/agents/verification.md)。不要机械全量运行。

## 配置

复制 `.env.example` 到 `.env`，填入 LLM API Key。App 配置和 API Key 运行时由 Settings 页面管理，API Key 通过 keytar 写入系统钥匙串。

NarraCat Agent Core 源码位于 `agent-core/narracat/`，开发启动会校验缺失的运行适配器产物；打包后复制为 Electron resources 下的 `NarraCatAgentCore`。版本锁和打包验收流程见 [`resources/README.md`](resources/README.md)。

## 文档入口

进入项目时优先阅读：

1. [`AGENTS.md`](AGENTS.md)：项目约束、架构和工作方式。
2. [`CONTEXT.md`](CONTEXT.md)：统一术语。
3. [`docs/agents/progress.md`](docs/agents/progress.md)：当前阶段和下一步。
4. [`docs/agents/workflow.md`](docs/agents/workflow.md)：OPS 路由规则。
5. [`docs/agents/verification.md`](docs/agents/verification.md)：验证矩阵。
6. [`docs/adr/`](docs/adr)：已接受的架构决策。

## 历史资料

[`poc/`](poc/) 和 [`docs/poc-results.md`](docs/poc-results.md) 是 Phase 0 技术验证材料，不属于当前 App 运行时代码，也不属于当前验证流程。

历史计划和规格保留在 [`docs/superpowers/`](docs/superpowers/) 和 [`docs/plans/`](docs/plans/)；当前工作以 OPS 文档和相关 issue / plan 为准。
