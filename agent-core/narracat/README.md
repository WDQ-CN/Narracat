# NarraCat Agent Core

NarraCat-app 内部维护的创作引擎（不是上游插件镜像），为 AI 辅助超长篇小说创作（50-500 章，20万-300万字）提供完整工具链。App 层通过 pi agent runtime 装配本引擎，以 `narracat.manifest.json` 为唯一契约清单发现与校验。

## 功能特性

- **分层大纲规划** — 全书→卷→arc→章节分层结构，预算表驱动，自动管理叙事弧线和节奏
- **核心写作循环** — 上下文聚合→正文生成→客观错误审校→记忆入库，闭环推进
- **双层最小审校** — 代码机械层 + 客观错误审校（连续性 / 设定 / 锚点 / 伏笔合同 / 物理可能性）
- **分层记忆系统** — 嵌入式 SQLite + FTS5/向量混合检索；近章 brief 热层 + arc/卷摘要温层 + 受控谓词事实库
- **伏笔生命周期管理** — 从埋设到揭示的全程追踪，状态由动作日志机械导出
- **协作/自动双模式** — 每步确认或全自动推进，按需切换

## 产品定位

**NarraCat 的默认产出是 80 分草稿，不是发布稿。** 这是与头部网文作家真实 AI 工作流对齐的设计选择，不是技术妥协。

| 使用路径 | NarraCat 适配度 |
|---|---|
| AI 出 20-30 分草稿 → 人改 50%+ → 80 分发布（头部签约作家路径） | ✅ 推荐 |
| 把 NarraCat 产出当未润色初稿，人改 30-50% 后发布 | ✅ 主流路径 |
| 把 NarraCat 产出直接发到平台 | ⚠️ 不推荐——平台风控正在收紧 |

continuity-editor、伏笔追踪、章节审修循环等系统**是辅助人改的工具**，不是用来逼 LLM 自动达到发布水准的——后者在 2026 年的 LLM 上仍是技术不可达的目标（25 章后所有商业工具实测均出现自相矛盾）。设计论证见 `docs/adr/0006-antipattern-injection-position-accepted.md`。

## 架构

```
用户交互层   Commands(13) → 主会话（编排者，派发只传路径+参数的 Envelope）
专业Agent层  5 个 Subagent → 通过 Task 工具调用
引擎层       NovelMemory MCP Server（TypeScript, stdio, 嵌入式 SQLite + FTS5）
机械层       App 侧原生门控（TypeScript 重实现的产物/回执核对）+ 工具机械渲染（大纲 md / 审校报告 / 叙述者腔调节）
```

结构化数据一律经 NovelMemory MCP 工具入口提交（ajv 校验，失败返回字段级 errors + hint 供自修正）；每个 agent 只持有自己产物的提交工具，Agent 不直接通信。

## 前置依赖

- [NarraCat 桌面应用](../../README.md)（内嵌 pi agent runtime，负责装配本引擎）
- Node.js 18+（MCP Server 运行时；开发调试 mcp-server 时需要）

## 使用方式

本引擎不独立运行，只能通过 NarraCat 桌面应用装配使用：

```bash
# 在仓库根目录（narracat-app）启动开发模式，App 会按 narracat.manifest.json 发现并装配本引擎
bun --no-cache run dev
```

## 命令

| 命令 | 说明 | 典型用法 |
|------|------|----------|
| `/narracat:init` | 初始化小说项目（纯机械） | `/narracat:init 星辰大海` |
| `/narracat:setup` | 立项对话（grill 式追问 → 网文立项卡） | `/narracat:setup` |
| `/narracat:reference` | 分析参考作品（生成项目级指导） | `/narracat:reference` |
| `/narracat:world` | 管理世界观和角色（支持批量立项） | `/narracat:world 创建主角张三` |
| `/narracat:plan` | 规划/修改大纲（预算表驱动） | `/narracat:plan` |
| `/narracat:write` | 核心写作循环 | `/narracat:write 1` |
| `/narracat:review` | 手动审校章节（深审模式只标注不回流） | `/narracat:review 40-45` |
| `/narracat:rewrite` | 重写已完成章节 | `/narracat:rewrite 20` |
| `/narracat:status` | 查看项目进度 | `/narracat:status` |
| `/narracat:revise-premise` | 立项卡定点修订（先评级联影响、确认后再落改） | `/narracat:revise-premise 对抗力量` |
| `/narracat:sync-chapter-memory` | 手改正文后同步本章记忆 | `/narracat:sync-chapter-memory 12` |
| `/narracat:learn-craft` | 从书学写法（App 在独立学习工作区编排，产出能力卡草稿） | 由 App 造包中心触发，非小说项目内直接调用 |
| `/narracat:writer-wizard` | 作家向导（多轮访谈把作者自述写法整理成能力卡草稿） | 由 App 造包中心触发，非小说项目内直接调用 |

完整命令清单以 `narracat.manifest.json` 的 `commands` 字段为 SSOT。

## 典型工作流

```
/narracat:init 星辰大海          # 1. 初始化项目
/narracat:reference              # 2. （可选）分析参考作品生成项目级指导
/narracat:setup                  # 3. 立项对话（九张立项卡）
/narracat:world 创建主角张三      # 4. 建立角色
/narracat:world 设计魔法体系      # 5. 构建世界观
/narracat:plan                   # 6. 规划大纲
/narracat:write 1                # 7. 开始写作
/narracat:write 2                # 8. 继续...
/narracat:status                 # 9. 查看进度
```

## Agent 分工

每个 agent 只持有自己产物的提交工具（框架级 `tools` 字段强制）：

| Agent | 职责 | 提交工具 |
|-------|------|----------|
| 大纲架构师 (outline-architect) | 书/卷+arc/章三层大纲产出 | novel_submit_outline / novel_submit_chapter_outline |
| 章节写手 (chapter-writer) | 根据 WritingContextPack 创作章节正文 | Write 仅写 manuscript（零元数据） |
| 审校编辑 (continuity-editor) | 5 类客观错误审校（连续性/设定/锚点/伏笔/物理） | novel_submit_review |
| 世界观策展人 (world-curator) | bible 合成 + 设定冲突检测（不落盘，主会话写入） | （无写入口） |
| 记忆管理员 (memory-keeper) | 章节摘要、事实提取、arc/卷压缩入库 | novel_commit_chapter / novel_submit_extraction / novel_consolidate |

## Skill 知识库

4.0 起写作上下文主要由 WritingContextPack 机械装配；写手只保留一个平台写作功底 Skill。Skill 收敛为 5 个：

| Skill | 消费方 | 职责 |
|-------|--------|------|
| novel-structure | outline-architect（唯一注入） | 叙事结构领域知识（戏剧力驱动、arc 三件套、伏笔节奏） |
| novel-web-craft | chapter-writer（唯一写作 Skill 注入） | 番茄向平台写作功底与章节正文执行标准 |
| novel-memory-integration | 主会话 | 4.0 工具表的记忆查询指南（对话场景用） |
| novel-style-reference | WritingContextPack builder + 按需查询 | 真人写作范例 corpus（带机制注解，按手法×情感查询） |
| novel-reference-analysis-method | 仅 /narracat:reference 显式调用 | 参考作品分析方法论与 5 维度框架；输出路径由 commands/reference.md 约定 |

负面知识（反模式）不进任何 prompt：可机械检测子集下沉为代码扫描，词表并入 `mcp-server/src/data/prose-hygiene-lexicon.ts`（旧反模式扫描 Skill 已退役，生成端零负面，见 ADR-0006）。

## 小说项目结构

执行 `/narracat:init` 后生成：

```
my-novel/
├── .narracat/
│   ├── config.yaml          # 项目配置（novel_id, 题材, 自动化级别, 字数目标, 风格档位）
│   ├── state.yaml           # 进度状态（完成章节, 字数, 断点；全部经 MCP 工具写入）
│   ├── memory.db            # SQLite 记忆数据库（自动创建）
│   ├── context-packs/       # WritingContextPack 落盘（ch-NNN.json）
│   └── receipts/            # 章节入库回执（ch-NNN.json，hook 核对用）
├── bible/                   # 设定集
│   ├── characters/          # 角色档案
│   ├── world/               # 世界观设定
│   ├── references/          # 原始参考作品（.md / .txt）
│   ├── reference-guidance/  # 参考作品分析产出（由 /narracat:reference 生成，可选）
│   ├── premise.md           # 网文立项卡（setup 产出）
│   └── relationships.md     # 角色关系图谱
├── outline/                 # 分层大纲
│   ├── master-outline.md
│   └── vol-XX/
│       ├── vol-outline.md
│       └── ch-XXX.md
├── manuscript/              # 正文
│   └── vol-XX/ch-XXX.md
├── reviews/                 # 审校报告
└── notes/                   # 自由笔记
```

## 目录结构

```
narracat/
├── narracat.manifest.json          # 契约清单（SSOT）— App 层按此发现与装配 commands/agents/skills/schemas
├── commands/                       # 13 个 Command
│   ├── init.md                     #   初始化项目 — 创建目录结构和配置文件（纯机械）
│   ├── setup.md                    #   立项对话 — grill 式追问 → 九张立项卡落盘 premise.md
│   ├── reference.md                #   参考作品分析 — 从 bible/references/ 生成 bible/reference-guidance/
│   ├── world.md                    #   世界观管理 — 批量立项 + 冲突检测
│   ├── plan.md                     #   大纲规划 — 预算表派发，书/卷+arc/章三层
│   ├── write.md                    #   核心写作循环 — 上下文聚合→生成→审修→入库
│   ├── review.md                   #   手动审校 — 模式 A 同主链 L1；模式 B 深审标注不回流
│   ├── rewrite.md                  #   重写章节 — 记忆回滚→重写→级联影响分析
│   ├── status.md                   #   进度查看 — 章节完成度、字数统计、伏笔追踪
│   ├── revise-premise.md           #   立项卡定点修订 — 先评级联影响、确认后再落改
│   ├── sync-chapter-memory.md      #   手改正文后同步本章记忆 — 回滚重抽→矛盾提示
│   ├── learn-craft.md              #   从书学写法 — 产出能力卡草稿（App 在独立学习工作区编排）
│   └── writer-wizard.md            #   作家向导 — 多轮访谈整理写法为能力卡草稿（App 在独立向导工作区编排）
├── agents/                         # 5 个 Agent
│   ├── outline-architect.md        #   大纲架构师 — 三层大纲产出，经提交工具自校验入库
│   ├── chapter-writer.md           #   章节写手 — 根据 WritingContextPack 创作正文（只产正文）
│   ├── continuity-editor.md        #   审校编辑 — 5 类客观错误审校，报告由工具渲染
│   ├── world-curator.md            #   世界观策展人 — bible 合成 + 冲突检测
│   └── memory-keeper.md            #   记忆管理员 — 摘要/事实/压缩三件事入库
├── skills/                         # 5 个 Skill
│   ├── novel-structure/            #   叙事结构领域知识（仅注入 outline-architect）
│   ├── novel-web-craft/            #   平台写作功底（仅注入 chapter-writer）
│   ├── novel-memory-integration/   #   记忆查询指南（主会话）
│   ├── novel-style-reference/      #   真人写作范例 corpus（带机制注解）
│   └── novel-reference-analysis-method/   #   参考作品分析方法论（仅 /narracat:reference 显式调用）
├── hooks/                          # 旧运行时 hook 格式遗留物，见下方说明
│   ├── hooks.json                  #   SubagentStop + PostToolUse 事件定义（全部 command 脚本）
│   └── scripts/                    #   参照脚本（产物存在性 / receipt 核对 / 字数检查）
├── schemas/                        # 11 个数据契约（SSOT）
│   ├── writing-context-pack.json   #   写作上下文包 — builder 产出，章节写作的唯一输入
│   ├── review-report.json          #   审校提交 — novel_submit_review 参数契约
│   ├── memory-extraction.json      #   事实提取 — novel_submit_extraction 参数契约
│   ├── outline-structure.json      #   大纲结构 — 书/卷+arc/章三层结构化格式
│   ├── foreshadowing-system.json   #   伏笔系统 — 注册与生命周期契约
│   ├── cascade-impact-report.json  #   级联影响报告 — 重写后对后续章节的影响分析
│   ├── premise-cards.json          #   九张立项卡 — setup/revise-premise 数据契约
│   ├── authored-state.json         #   人工编辑态标记 — 区分机械写入与作者直改字段
│   ├── character-entity.json       #   角色结构化实体 — world-curator 提交契约
│   ├── dialogue-samples.json       #   台词语料 — 角色语音特征样本契约
│   └── state-vocabulary.json       #   受控词表 — 谓词/枚举值域契约
├── mcp-server/                     # NovelMemory MCP Server (TypeScript, stdio, SQLite + FTS5)
├── templates/                      # 项目初始化模板（init 时复制）
├── packs/                          # 官方能力包（造包中心的官方供给）
├── scripts/                        # 辅助脚本（lint 等）
└── docs/                           # 设计文档与规格
```

`hooks/` 是旧运行时的 hook 格式遗留物，现行运行时不执行；等价校验逻辑已在 App 侧以 TypeScript 重实现，这里的 `hooks.json` + `scripts/` 仅保留作行为基线参照，不是当前生效机制。

## 开发

```bash
# MCP Server 编译检查 + 测试
cd mcp-server && npm run build
cd mcp-server && npm run test
```

维护者层规则、写权限模型与核心纪律见 `CLAUDE.md`；4.0 架构的权威规格见 `docs/plans/2026-06-12-agent-core-4.0-rebuild-design.md`。

## 许可

MIT
