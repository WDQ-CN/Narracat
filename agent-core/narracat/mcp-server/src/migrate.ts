/**
 * Schema 初始化（全新建库）
 *
 * 4.0 起不做旧库迁移：存量项目不兼容，新架构只服务新项目。
 * 打开数据库时：
 * - 全新库 → 执行完整 DDL，写入 schema_version
 * - 同版本库 → 直接通过
 * - 旧版本库 → 抛错（提示新建项目），不做任何就地改写
 */

import type Database from "better-sqlite3";

export const SCHEMA_VERSION = 21;

export const DDL = `
-- 元信息
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 章节摘要 + ChapterBrief（novel_commit_chapter 唯一写入口）
-- word_count / snippet 两列由工具读 manuscript 机械补全
CREATE TABLE IF NOT EXISTS chapter_summaries (
  id                 TEXT PRIMARY KEY,
  novel_id           TEXT NOT NULL,
  chapter            INTEGER NOT NULL,
  summary            TEXT NOT NULL,
  characters         TEXT NOT NULL DEFAULT '[]',
  events             TEXT NOT NULL DEFAULT '[]',
  word_count         INTEGER,
  opening_snippet    TEXT,
  ending_snippet     TEXT,
  anchor_core        TEXT,
  anchor_heartbeat   TEXT,
  emotional_tone     TEXT,
  continuation_hook  TEXT NOT NULL DEFAULT '[]',
  timeline_note      TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(novel_id, chapter)
);

-- 事实三元组（novel_submit_extraction 唯一写入口；受控谓词 + 别名归一在入口完成）
-- 有效性单一记账：invalidated_at_chapter IS NULL = 有效；非 NULL = 从该章起失效
-- subject_character_uid: 角色 subject 的 canonical uid（工具入口按角色档案 character_identity 解析）；
--   relationship 两端用 subject_character_uid(字典序小) + subject_character_b_uid(大)；非角色 subject 两者 NULL
-- source: 'extracted'=正文抽取 / 'authored'=作者钦定或设计期入账（值域由写入口守卫，不加 CHECK 保新旧库同构）
-- secret_known: 0=未知晓 / 1=本人已知晓，仅对 predicate='secret' 行有业务含义（片4 处境包）
CREATE TABLE IF NOT EXISTS facts (
  id                       TEXT PRIMARY KEY,
  novel_id                 TEXT NOT NULL,
  subject                  TEXT NOT NULL,
  subject_character_uid    TEXT,
  subject_character_b_uid  TEXT,
  predicate                TEXT NOT NULL,
  object                   TEXT NOT NULL,
  sector                  TEXT NOT NULL DEFAULT 'semantic',
  from_chapter            INTEGER NOT NULL,
  event_chapter           INTEGER,
  invalidated_at_chapter  INTEGER,
  invalidated_by          TEXT,
  source                  TEXT NOT NULL DEFAULT 'extracted',
  secret_known            INTEGER NOT NULL DEFAULT 0,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 世界观/规则
CREATE TABLE IF NOT EXISTS settings (
  id          TEXT PRIMARY KEY,
  novel_id    TEXT NOT NULL,
  content     TEXT NOT NULL,
  sector      TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 伏笔注册表（novel_submit_outline 随书级大纲注册；novel_register_foreshadowing 补登）
-- target_reveal: 章号字符串（如 '120'）或卷级粗锚点（如 'vol-08'）
CREATE TABLE IF NOT EXISTS foreshadowing_registry (
  novel_id        TEXT NOT NULL,
  id              TEXT NOT NULL,
  type            TEXT NOT NULL CHECK(type IN ('small','medium','major')),
  description     TEXT NOT NULL,
  planted_chapter INTEGER,
  target_reveal   TEXT,
  theme_link      TEXT,
  PRIMARY KEY (novel_id, id)
);

-- 伏笔动作日志：伏笔状态一律从最新 action 机械导出，不另行记账
-- status: planned = 章纲提交时预登记；realized = novel_commit_chapter 兑现登记
CREATE TABLE IF NOT EXISTS foreshadowing_actions_log (
  novel_id          TEXT NOT NULL,
  chapter           INTEGER NOT NULL,
  foreshadowing_id  TEXT NOT NULL,
  action            TEXT NOT NULL CHECK(action IN ('plant','develop','reveal')),
  status            TEXT NOT NULL DEFAULT 'realized' CHECK(status IN ('planned','realized')),
  PRIMARY KEY (novel_id, chapter, foreshadowing_id, action, status)
);

-- arc 元信息（novel_submit_outline 写入；网文副本粒度）
-- antagonist_agent: 本 arc 具体施压者（issue #429，可空——日常流/无对抗 arc 允许留空，无 WARN）
CREATE TABLE IF NOT EXISTS arc_meta (
  novel_id            TEXT NOT NULL,
  arc_id              TEXT NOT NULL,
  volume_no           INTEGER NOT NULL,
  title               TEXT NOT NULL,
  chapter_start       INTEGER NOT NULL,
  chapter_end         INTEGER NOT NULL,
  core_question       TEXT NOT NULL,
  irreversible_change TEXT NOT NULL,
  next_arc_seed       TEXT NOT NULL,
  antagonist_agent    TEXT,
  payoff_beats        TEXT NOT NULL DEFAULT '[]',
  PRIMARY KEY (novel_id, arc_id)
);

-- L2 温层：arc / 卷压缩摘要（novel_consolidate upsert）
CREATE TABLE IF NOT EXISTS arc_summaries (
  novel_id      TEXT NOT NULL,
  scope         TEXT NOT NULL CHECK(scope IN ('arc','volume')),
  scope_id      TEXT NOT NULL,
  chapter_start INTEGER NOT NULL,
  chapter_end   INTEGER NOT NULL,
  summary       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (novel_id, scope, scope_id)
);

-- 角色状态卡：由受控谓词 facts 机械折叠（每谓词取最新值），arc 收尾时刷新
-- character_uid 为 canonical 身份主键；character name 作人读冗余
CREATE TABLE IF NOT EXISTS character_cards (
  novel_id      TEXT NOT NULL,
  character_uid TEXT NOT NULL,
  character     TEXT NOT NULL,
  as_of_chapter INTEGER NOT NULL,
  card_json     TEXT NOT NULL,
  PRIMARY KEY (novel_id, character_uid)
);

-- 故事线注册表（novel_submit_outline 写入）
-- is_through_line: 作者显式标注的全书贯穿线（身世/宿敌/全书核心线）；WCP 常驻层据此过滤，永不随卷滚动丢弃
CREATE TABLE IF NOT EXISTS storylines (
  novel_id               TEXT NOT NULL,
  id                     TEXT NOT NULL,
  name                   TEXT NOT NULL,
  type                   TEXT NOT NULL CHECK(type IN ('main','growth','romance','faction','mystery','rivalry','world','other')),
  priority               INTEGER NOT NULL,
  entry_chapter          INTEGER NOT NULL,
  planned_payoff_chapter INTEGER,
  status                 TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','dormant','resolved')),
  is_through_line        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (novel_id, id)
);

-- 章 × 故事线聚焦（novel_submit_chapter_outline 机械写入）
CREATE TABLE IF NOT EXISTS chapter_storyline_focus (
  novel_id     TEXT NOT NULL,
  chapter      INTEGER NOT NULL,
  storyline_id TEXT NOT NULL,
  PRIMARY KEY (novel_id, chapter, storyline_id)
);

-- 审校路由信号（novel_submit_review 写入；novel_get_review 读取）
-- reviewed_manuscript_sha256: 提交审校时正文文件全文 SHA-256（十六进制）；
--   novel_update_progress 据此做审校新鲜度硬门；旧行 NULL = 无指纹，硬门视为需重新审校
CREATE TABLE IF NOT EXISTS chapter_reviews (
  novel_id    TEXT NOT NULL,
  chapter     INTEGER NOT NULL,
  verdict     TEXT NOT NULL CHECK(verdict IN ('pass','fail')),
  issues_json TEXT NOT NULL DEFAULT '[]',
  reviewed_manuscript_sha256 TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (novel_id, chapter)
);

-- 本书声音样章锚（novel_submit_style_anchor 唯一写入口；App 划选标记，WCP style_examples 消费）
-- excerpt 是标记那一刻的正文快照：作者事后改该章正文不回溯改锚（锚记的是「当时那个语感」）
CREATE TABLE IF NOT EXISTS style_anchors (
  novel_id   TEXT NOT NULL,
  anchor_id  TEXT NOT NULL,
  chapter    INTEGER NOT NULL,
  excerpt    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (novel_id, anchor_id)
);
CREATE INDEX IF NOT EXISTS idx_style_anchors_novel ON style_anchors(novel_id, created_at);

-- 立项卡（novel_submit_premise 唯一写入口；premise.md 由工具机械渲染为只读视图）
-- cards_json: 完整九卡 payload（含每条 certainty）；DTO 投影到 bible/premise-cards.json
-- 单行/小说，与 chapter_reviews 同模式（真相在库，App 经数据契约读取，不解析 premise.md）
CREATE TABLE IF NOT EXISTS premise_cards (
  novel_id   TEXT NOT NULL,
  cards_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (novel_id)
);

-- 候选角色池（novel_register_candidate_character 唯一写入口；ADR-0015 渐进生长内容实例层）
-- plan/write 期引入未建档角色时，作者选「留作候选」即入此表，不强制完整设定、不打断创作流。
-- character_uid 落盘即铸定（CharacterReference 契约），将来建档复用同一 UID；
-- proposed_chapter = 首次被提及/计划出场的章号（可空）；status: candidate（待出场）/ promoted（已建档）
-- importance（ADR-0023 候选角色重要度）：minor（次要，进池静默不提醒，默认）/ major（重要，写完正文提醒建档）；
--   一次性龙套是「不写入本表」的结果，不占枚举值。默认 minor = 不确信重要就不打扰作者。
CREATE TABLE IF NOT EXISTS candidate_characters (
  novel_id        TEXT NOT NULL,
  character_uid   TEXT NOT NULL,
  name            TEXT NOT NULL,
  note            TEXT,
  proposed_chapter INTEGER,
  initial_relationships TEXT DEFAULT '[]',
  importance      TEXT NOT NULL DEFAULT 'minor' CHECK(importance IN ('minor','major')),
  source          TEXT NOT NULL DEFAULT 'write' CHECK(source IN ('plan','write','manual')),
  status          TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate','promoted')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (novel_id, character_uid)
);

-- 多采样抽取暂存（novel_stage_extraction 写、novel_commit_extraction_union 读后清）
-- 每轮抽取把「已校验 + 已 UID 解析」的 ResolvedFact[] 序列化为 facts_json 暂存，
-- 按 (novel_id, chapter, run_id) 唯一隔离（UNIQUE 约束；同一 run_id 重试经 upsert 幂等覆盖，不留陈旧行）；不进正式 facts、不建 FTS/vec 索引。
-- commit-union 读该章所有 run、全等去重后一次落库，落库后删除该章暂存行。
CREATE TABLE IF NOT EXISTS extraction_stage (
  id          TEXT PRIMARY KEY,
  novel_id    TEXT NOT NULL,
  chapter     INTEGER NOT NULL,
  run_id      INTEGER NOT NULL,
  facts_json  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(novel_id, chapter, run_id)
);
CREATE INDEX IF NOT EXISTS idx_stage_novel_chapter ON extraction_stage(novel_id, chapter);
CREATE INDEX IF NOT EXISTS idx_stage_novel_chapter_run ON extraction_stage(novel_id, chapter, run_id);

-- FTS5 全文索引 (跨表统一检索)
-- trigram 分词器：支持 CJK 子串匹配（最少 3 字符），零外部依赖
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
  content,
  source_table UNINDEXED,
  source_id UNINDEXED,
  novel_id UNINDEXED,
  sector UNINDEXED,
  tokenize='trigram'
);

-- 常用查询索引
CREATE INDEX IF NOT EXISTS idx_summaries_novel_chapter ON chapter_summaries(novel_id, chapter);
CREATE INDEX IF NOT EXISTS idx_facts_novel_subject ON facts(novel_id, subject);
CREATE INDEX IF NOT EXISTS idx_facts_novel_subject_uid ON facts(novel_id, subject_character_uid);
CREATE INDEX IF NOT EXISTS idx_facts_novel_predicate ON facts(novel_id, predicate);
CREATE INDEX IF NOT EXISTS idx_facts_novel_valid ON facts(novel_id, invalidated_at_chapter);
CREATE INDEX IF NOT EXISTS idx_settings_novel_sector ON settings(novel_id, sector);
CREATE INDEX IF NOT EXISTS idx_focus_novel_chapter ON chapter_storyline_focus(novel_id, chapter);
CREATE INDEX IF NOT EXISTS idx_arc_meta_novel_range ON arc_meta(novel_id, chapter_start, chapter_end);
CREATE INDEX IF NOT EXISTS idx_candidate_novel_status ON candidate_characters(novel_id, status);

-- 角色台词语料（novel_submit_dialogue_samples 唯一写入口；A1 声音支柱：持续积累角色真实台词供风格卡生成）
-- dialogue_type: dialogue=对话台词 / monologue=独白 / thought=心理活动 / action_narration=动作旁白
-- character_uid: 别名归一后的 canonical uid（未命中则跳过不写入：保证此列恒为真 uid，按 uid 查的读路径不产生死行）
-- UNIQUE(novel_id, chapter, character_uid, dialogue_text) 防重复入库
CREATE TABLE IF NOT EXISTS character_dialogue_samples (
  id                   TEXT PRIMARY KEY,
  novel_id             TEXT NOT NULL,
  chapter              INTEGER NOT NULL,
  character            TEXT NOT NULL,
  character_uid        TEXT NOT NULL,
  dialogue_text        TEXT NOT NULL,
  context              TEXT,
  emotion              TEXT,
  dialogue_type        TEXT NOT NULL CHECK(dialogue_type IN ('dialogue','monologue','thought','action_narration')),
  position_in_chapter  INTEGER,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(novel_id, chapter, character_uid, dialogue_text)
);
CREATE INDEX IF NOT EXISTS idx_dialogue_samples_novel_chapter ON character_dialogue_samples(novel_id, chapter);
CREATE INDEX IF NOT EXISTS idx_dialogue_samples_novel_uid ON character_dialogue_samples(novel_id, character_uid);

-- 章级计划状态变更账本（novel_submit_chapter_outline 镜像写入；与 facts 事实账分离，planned 不进 facts）
-- status 五态：planned=待兑现 / delivered=已兑现（novel_check_state_delivery 机械落）/
--   deferred=作者移到后续章（原行留审计，deferred_to_chapter 指向新行所在章）/
--   cancelled=作者取消 / acknowledged=作者已知悉不一致（不再重复报警）
-- 重提交镜像纪律：按章 DELETE status='planned' 后插新集；已处置行是历史账保留；
--   新集条目与该章任意状态既有行同键（uid+dimension+operation+value）时跳过不重插
CREATE TABLE IF NOT EXISTS planned_state_changes (
  id                   TEXT PRIMARY KEY,
  novel_id             TEXT NOT NULL,
  chapter              INTEGER NOT NULL,
  character_uid        TEXT NOT NULL,
  character_name       TEXT NOT NULL,
  dimension            TEXT NOT NULL,
  operation            TEXT NOT NULL CHECK(operation IN ('set','add','remove')),
  value                TEXT NOT NULL,
  reason               TEXT,
  status               TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','delivered','deferred','cancelled','acknowledged')),
  deferred_to_chapter  INTEGER,
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_planned_state_novel_chapter ON planned_state_changes(novel_id, chapter);
`;

/** 幂等加列：列已存在则跳过，否则 ALTER TABLE ADD COLUMN。 */
function ensureColumn(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * 加列型迁移约定（仅限 additive，不开复杂迁移链）：键 = 目标版本号，值 = 把上一版升到该版的幂等加列步骤。
 * 只支持「加可空/带默认值的列」这一类向前兼容改动；改类型 / 删列 / 重命名等破坏性改动仍走「不迁移、重建」。
 */
const ADDITIVE_MIGRATIONS: Record<number, (db: Database.Database) => void> = {
  // 9 → 10：候选表加 initial_relationships（候选与已建档角色的初始关系草稿，转正建档时回写）。
  10: (db) => ensureColumn(db, "candidate_characters", "initial_relationships", "TEXT DEFAULT '[]'"),
  // 10 → 11：故事线表加 is_through_line（全书贯穿线标记，WCP 常驻层据此豁免卷滚动丢弃）。
  11: (db) => ensureColumn(db, "storylines", "is_through_line", "INTEGER NOT NULL DEFAULT 0"),
  // 11 → 12：新建 extraction_stage 暂存表 + 两条索引（多采样并集抽取，新表非加列，用 db.exec 幂等建表）。
  12: (db) =>
    db.exec(`
      CREATE TABLE IF NOT EXISTS extraction_stage (
        id          TEXT PRIMARY KEY,
        novel_id    TEXT NOT NULL,
        chapter     INTEGER NOT NULL,
        run_id      INTEGER NOT NULL,
        facts_json  TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(novel_id, chapter, run_id)
      );
      CREATE INDEX IF NOT EXISTS idx_stage_novel_chapter ON extraction_stage(novel_id, chapter);
      CREATE INDEX IF NOT EXISTS idx_stage_novel_chapter_run ON extraction_stage(novel_id, chapter, run_id);
    `),
  // 12 → 13：facts 加 event_chapter（事件发生章，回填 = from_chapter）+ invalidated_by（失效溯源指针）。
  13: (db) => {
    ensureColumn(db, "facts", "event_chapter", "INTEGER");
    db.exec("UPDATE facts SET event_chapter = from_chapter WHERE event_chapter IS NULL");
    ensureColumn(db, "facts", "invalidated_by", "TEXT");
  },
  // 13 → 14：候选表加 importance（ADR-0023 候选角色重要度）。旧行落默认 minor=次要静默，立即止住对龙套的提醒。
  14: (db) => ensureColumn(db, "candidate_characters", "importance", "TEXT NOT NULL DEFAULT 'minor'"),
  // 14 → 15：新建 character_dialogue_samples 台词语料表 + 两条索引（支柱 A 声音地基，新表由 db.exec 幂等建表）。
  15: (db) =>
    db.exec(`
      CREATE TABLE IF NOT EXISTS character_dialogue_samples (
        id                   TEXT PRIMARY KEY,
        novel_id             TEXT NOT NULL,
        chapter              INTEGER NOT NULL,
        character            TEXT NOT NULL,
        character_uid        TEXT NOT NULL,
        dialogue_text        TEXT NOT NULL,
        context              TEXT,
        emotion              TEXT,
        dialogue_type        TEXT NOT NULL CHECK(dialogue_type IN ('dialogue','monologue','thought','action_narration')),
        position_in_chapter  INTEGER,
        created_at           TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(novel_id, chapter, character_uid, dialogue_text)
      );
      CREATE INDEX IF NOT EXISTS idx_dialogue_samples_novel_chapter ON character_dialogue_samples(novel_id, chapter);
      CREATE INDEX IF NOT EXISTS idx_dialogue_samples_novel_uid ON character_dialogue_samples(novel_id, character_uid);
    `),
  // 15 → 16：arc_meta 加 antagonist_agent（issue #429，本 arc 具体施压者，可空——存量 arc 回填 NULL，
  // 无 WARN、无 required，日常流/无对抗 arc 允许留空）。
  16: (db) => ensureColumn(db, "arc_meta", "antagonist_agent", "TEXT"),
  // 16 → 17：facts 加 source（事实来源：extracted=抽取 / authored=作者），存量行落默认 extracted。
  17: (db) => ensureColumn(db, "facts", "source", "TEXT NOT NULL DEFAULT 'extracted'"),
  // 17 → 18：新建 planned_state_changes 章级计划状态变更账本（A4×D2 片3 兑现门，新表由 db.exec 幂等建表）。
  18: (db) =>
    db.exec(`
      CREATE TABLE IF NOT EXISTS planned_state_changes (
        id                   TEXT PRIMARY KEY,
        novel_id             TEXT NOT NULL,
        chapter              INTEGER NOT NULL,
        character_uid        TEXT NOT NULL,
        character_name       TEXT NOT NULL,
        dimension            TEXT NOT NULL,
        operation            TEXT NOT NULL CHECK(operation IN ('set','add','remove')),
        value                TEXT NOT NULL,
        reason               TEXT,
        status               TEXT NOT NULL DEFAULT 'planned' CHECK(status IN ('planned','delivered','deferred','cancelled','acknowledged')),
        deferred_to_chapter  INTEGER,
        created_at           TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_planned_state_novel_chapter ON planned_state_changes(novel_id, chapter);
    `),
  // 18 → 19：facts 加 secret_known（secret 谓词「本人已知晓」标记，A4×D2 片4 处境包按此放行；0=未知晓）。
  19: (db) => ensureColumn(db, "facts", "secret_known", "INTEGER NOT NULL DEFAULT 0"),
  // 19 → 20：chapter_reviews 加 reviewed_manuscript_sha256（审校时正文指纹，新鲜度硬门依据）。
  20: (db) => ensureColumn(db, "chapter_reviews", "reviewed_manuscript_sha256", "TEXT"),
  // 20 → 21：新建 style_anchors（本书声音样章锚，App 划选标记；新表由 db.exec 幂等建表）。
  21: (db) =>
    db.exec(`
      CREATE TABLE IF NOT EXISTS style_anchors (
        novel_id   TEXT NOT NULL,
        anchor_id  TEXT NOT NULL,
        chapter    INTEGER NOT NULL,
        excerpt    TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (novel_id, anchor_id)
      );
      CREATE INDEX IF NOT EXISTS idx_style_anchors_novel ON style_anchors(novel_id, created_at);
    `),
};

/**
 * 初始化或校验 Schema。
 *
 * - 全新库：执行完整 DDL + 写入 schema_version
 * - schema_version === SCHEMA_VERSION：通过
 * - schema_version < SCHEMA_VERSION：逐版本应用 ADDITIVE_MIGRATIONS（幂等加列）就地升级，零数据丢失；
 *   缺对应加列迁移（即版本间有破坏性改动）则抛错，回到「重建」路径
 * - schema_version > SCHEMA_VERSION：降级不支持，抛错
 */
export function initSchema(db: Database.Database): void {
  const metaExists = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'",
    )
    .get();

  if (!metaExists) {
    db.exec(DDL);
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(
      String(SCHEMA_VERSION),
    );
    return;
  }

  const row = db
    .prepare("SELECT value FROM meta WHERE key = 'schema_version'")
    .get() as { value: string } | undefined;
  const currentVersion = row ? parseInt(row.value, 10) : 0;

  if (currentVersion === SCHEMA_VERSION) return;

  if (currentVersion < SCHEMA_VERSION) {
    for (let target = currentVersion + 1; target <= SCHEMA_VERSION; target += 1) {
      const migrate = ADDITIVE_MIGRATIONS[target];
      if (!migrate) {
        throw new Error(
          `memory.db schema 无法从 ${currentVersion} 升到 ${SCHEMA_VERSION}：缺 v${target} 的加列迁移` +
            `（该版含破坏性改动）。请新建小说项目，或移除旧的 .narracat/memory.db 后重新初始化。`,
        );
      }
      migrate(db);
    }
    db.prepare("UPDATE meta SET value = ? WHERE key = 'schema_version'").run(String(SCHEMA_VERSION));
    return;
  }

  throw new Error(
    `memory.db schema 版本过新（当前 ${currentVersion}，本版本支持 ${SCHEMA_VERSION}），不支持降级。`,
  );
}

/**
 * 把 config.yaml 的 novel_id 记进 meta 表（config 是 novel_id 的 SSOT，业务表各行也用它写入）。
 *
 * 每次开库调用：全新库写入、存量库回填，幂等。App 侧直读 memory.db 的路径靠这一行确定
 * 当前库属于哪本小说；已存值与 config 不一致（如库被复制到别的小说目录）时以 config 为准并告警。
 */
export function recordNovelId(db: Database.Database, novelId: string): void {
  if (!novelId) {
    // fail-loud：空值静默跳过会让库停留在「无 novel_id」形态、有值库则在下方 upsert 时崩，
    // 同一错误两种结局极难排障；engine 主路径由 loadConfig 保证非空，这里防的是 JS 直调 dist 的调用方
    throw new Error("openDatabase/recordNovelId 需要非空 novelId（config.yaml 的 novel_id）。");
  }
  const row = db.prepare("SELECT value FROM meta WHERE key = 'novel_id'").get() as
    | { value: string }
    | undefined;

  if (row?.value === novelId) return;

  if (row) {
    console.error(
      `[NovelMemory] meta.novel_id（${row.value}）与 config.yaml（${novelId}）不一致，以 config 为准覆盖。`,
    );
  }

  db.prepare(
    "INSERT INTO meta (key, value) VALUES ('novel_id', ?) " +
      "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(novelId);
}
