<!--
PR description 模板。改动 schemas/*.json 时下方"下游影响评估"为必填——CI workflow agent-core-schema-pr-check.yml 会扫描关键字"下游影响"，缺失则 review 阻塞。
-->

## 改动概述

<!-- 1-3 句说明本 PR 解决什么问题 / 实现什么能力 -->

## 变更范围

<!-- 列出主要改动的文件/模块 -->

## 测试

<!-- 列出已跑过的测试 / 验证方式 -->

---

## 下游影响评估（改动 schemas/*.json 时必填）

> ⚠️ 改动 `schemas/*.json` 必须填写本节。CI 会强制检查 PR description 含关键字（中英文均可）：
> **下游影响** / 下游兼容 / 客户端影响 / 兼容性影响 / downstream impact / breaking change。
> 背景：`agent-core/narracat/schemas/*.json` 是引擎对外的数据契约，用户项目目录里已经落盘了
> 按旧 schema 写出的文件——silent breaking change 会让这些已有小说项目的数据读不回来。

<!--
若本 PR 未改 schemas/*.json，本节可删除或保留留空。
若改动了 schemas/*.json，请逐项填写：
-->

- **改动字段清单**：
  - <!-- 如：outline-structure.json: 新增 chapter.scenes[].pressure_point 必填字段 -->
- **下游影响范围**（哪些 Agent / MCP handler / 用户项目数据受影响）：
  - <!-- 如：chapter-writer 阶段一需读 pressure_point；老项目 outline 缺该字段，落 N/A 不报错 -->
- **兼容性策略**：
  - [ ] 完全向后兼容（仅新增可选字段）
  - [ ] 老数据需迁移（已提供 migration 脚本 / 启动钩子自动迁移）
  - [ ] Breaking change（已在 CHANGELOG 标注 / 升级注意事项）
- **客户端验证**：
  - <!-- 是否在 dogfood 项目上验证过 / 测试覆盖哪些场景 -->
