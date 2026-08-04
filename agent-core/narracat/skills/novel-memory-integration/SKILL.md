---
name: novel-memory-integration
description: Guide for answering natural language questions about novel content by querying NovelMemory MCP read tools from the main conversation. Use when the user asks about character state, relationships, chapter summaries, arc progress, foreshadowing status, or review verdicts of the current novel project.
---

当用户用自然语言询问小说内容（角色、情节、设定、伏笔、审校结果）时，调用 NovelMemory MCP 读工具检索后作答。

## 工具速查

| 工具 | 用途 | 典型问题 |
|---|---|---|
| `novel_query` | 混合检索（全文+语义，最通用） | "关于古戒指的线索有哪些" |
| `novel_chapter_summary` | 章节摘要（单章或范围） | "第20章讲了什么" / "最近三章发生了什么" |
| `novel_character_state` | 角色截至某章的状态 | "张三在第30章是什么身份" |
| `novel_relationship` | 两个角色的关系 | "张三和李四什么关系" |
| `novel_foreshadowing_status` | 伏笔状态 | "还有哪些伏笔没揭示" |
| `novel_get_arc` | 章节所属 arc 的核心问题与区间 | "当前这个剧情单元在讲什么" |
| `novel_get_review` | 某章审校结论与遗留问题 | "第12章审校通过了吗" |
| `novel_writing_context` | 写作前上下文聚合 | "为下一章做写作准备" |

## 选择工具

- 问题指向某章 / 某伏笔 → 用对应专用工具填章号 / id。
- 问题指向某角色（`novel_character_state` / `novel_relationship`）→ 先 Read 该角色档案 `bible/characters/<名>.md` 顶部 `character_identity` 取 `character_uid`，再按 uid 调用。
- 模糊或开放问题 → `novel_query`，用短查询词（人名、物件名、事件短语），不要把整段话塞进去。
- 跨维度问题 → 组合调用：先用专用工具拿事实，再用 `novel_query` 补相关段落。

例：「张三和李四的关系这几章怎么变的」→ Read 两角色档案取各自 `character_uid` → `novel_relationship` 拿当前状态 + `novel_chapter_summary` 拉相关章摘要，对照作答。

## 无结果与异常

- `novel_query` 无结果 → 换更短、更具体的查询词重试一次。
- 仍无结果 → 告知用户该信息未入库，建议直接读 `manuscript/` 对应章节。
- 工具报错 → 检查 `.narracat/config.yaml` 是否存在、`novel_id` 是否配置。

## 边界

- 查询结果反映已入库状态；刚写完尚未收尾入库的章节直接读 `manuscript/`。
- 本场景只读不写；所有结构化写入由各 agent 持有的提交工具完成。
