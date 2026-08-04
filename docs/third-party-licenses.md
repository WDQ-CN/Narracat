# 第三方依赖 License 审计

审计日期：2026-08-05
工具：`bunx license-checker --production --summary` / `--csv`（`license-checker@25.0.1`）

## 审计口径

本仓有两棵独立的 `node_modules` 依赖树，运行期都会随发行物分发，分别审计：

1. **仓库根目录**（App 层 + agent-core 主体的生产依赖）
2. **`agent-core/narracat/mcp-server`**（NovelMemory MCP Server 的生产依赖，含 `better-sqlite3`、`sharp` 等原生/运行期依赖，随包分发，不是仅开发期用到）

两次统计都排除了各自的自引用条目（`narracat-app@0.1.0`、`@narracat/mcp-server@4.0.161`）——这两条不是第三方依赖，是本项目自身，license-checker 会把没有显式 `license` 字段或标记为 `private: true` 的自身包分别归类为 `UNKNOWN` / `UNLICENSED`，与依赖合规无关（详见下方说明）。

## 结果：仓库根目录（492 个第三方包）

| License | 包数量 |
|---|---|
| MIT | 398 |
| Apache-2.0 | 39 |
| ISC | 22 |
| BSD-3-Clause | 17 |
| BSD-2-Clause | 6 |
| BlueOak-1.0.0 | 5 |
| Unlicense | 2 |
| (MIT OR WTFPL) | 1 |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1 |
| 0BSD | 1 |

以上均为宽松许可（permissive）或公共领域等价物，与 AGPL-3.0 分发完全兼容，无需处置。

（另有 1 条 `narracat-app@0.1.0` → `UNLICENSED`，是本项目自身在 `package.json` 标了 `"private": true` 触发的 license-checker 惯例分类，不代表真实许可证缺失——仓库根 `LICENSE` 文件与 `package.json.license` 字段均为 `AGPL-3.0-only`。已从上表计数中剔除。）

## 结果：`agent-core/narracat/mcp-server`（180 个第三方包）

| License | 包数量 |
|---|---|
| MIT | 131 |
| BSD-3-Clause | 17 |
| ISC | 14 |
| Apache-2.0 | 7 |
| BlueOak-1.0.0 | 4 |
| MIT* | 2 |
| LGPL-3.0-or-later | 1 |
| (MIT OR WTFPL) | 1 |
| BSD-2-Clause | 1 |
| (BSD-2-Clause OR MIT OR Apache-2.0) | 1 |
| (MIT OR CC0-1.0) | 1 |

（另有 1 条 `@narracat/mcp-server@4.0.161` → `UNKNOWN`，是本子包自身 `package.json` 缺 `license` 字段导致 license-checker 无法判定，不是第三方依赖问题；已从上表计数中剔除，但建议后续给该 `package.json` 补上 `license` 字段以消除误报。）

## 例外项逐个核查

| 包 | 声明 License | 核查结论 | 处置 |
|---|---|---|---|
| `@img/sharp-libvips-darwin-arm64@1.2.4` | `LGPL-3.0-or-later` | `sharp`（Apache-2.0，`@huggingface/transformers` 的生产依赖，用于图像预处理）通过原生绑定动态加载 `libvips`。libvips 官方许可证即为 LGPL-3.0-or-later。LGPL 允许以动态链接方式与非 LGPL 代码组合分发，不会把整体作品"传染"为 LGPL/GPL；LGPL 与 AGPL-3.0 属同一 GPL 许可证族，可以合并分发。 | 兼容，无需处置；仅记录来源以备将来许可证审计追溯 |
| `sqlite-vec@0.1.9` / `sqlite-vec-darwin-arm64@0.1.9` | `MIT*`（`*` 表示 license-checker 未在包内找到独立 LICENSE 文件比对，仅按 `package.json.license` 字段判定） | 包内 `package.json.license` 字段为 `"MIT OR Apache"`（双许可，可任选其一遵守）。按 MIT 条款使用即可，属宽松许可。 | 兼容，无需处置 |
| `expand-template@2.0.3`（根 + mcp-server） | `(MIT OR WTFPL)` | 双许可，均为宽松/公共领域等价许可 | 兼容，无需处置 |
| `type-fest@0.13.1`（mcp-server） | `(MIT OR CC0-1.0)` | 双许可，均为宽松/公共领域等价许可 | 兼容，无需处置 |
| `rc@1.2.8`（根） | `(BSD-2-Clause OR MIT OR Apache-2.0)` | 三选一宽松许可 | 兼容，无需处置 |

未发现任何红线许可证（`SSPL`、`BUSL`、`CC-BY-NC` 系列、`GPL-2.0-only`/`GPL-3.0-only` 单选强 copyleft、`Commons Clause` 等）。

## 结论

全部第三方依赖（根目录 492 个 + mcp-server 180 个）与 AGPL-3.0 分发兼容。

例外项（均已核查为兼容，非红线）：3 类共 6 条——1 条 `LGPL-3.0-or-later`（动态链接原生库，合规）、2 条 `MIT*`（双许可缺 LICENSE 文件比对，按 MIT 兼容）、3 条其余双许可标注（`(MIT OR WTFPL)`×2、`(MIT OR CC0-1.0)`×1，均宽松兼容）。

Concerns：无需拦截发布的红线项；唯一建议的后续小改动是给 `agent-core/narracat/mcp-server/package.json` 补上缺失的 `license` 字段（当前触发 license-checker 的 `UNKNOWN` 误报，不影响合规结论）。
