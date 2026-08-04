/**
 * NovelMemory MCP Server 类型定义
 *
 * SQLite 行类型 + 工具处理器签名 + 统一错误返回形状。
 */

import type Database from "better-sqlite3";

// ============================================================
// 统一错误返回形状
//
// 所有写入口校验失败时返回 { ok: false, errors: [...] }；
// hint 是写给上游 LLM 的修复指令，agent 据此自修正后重试。
// ============================================================

export interface ToolErrorItem {
  field: string;
  expected: string;
  actual: string;
  hint: string;
}

export interface ToolErrorResponse {
  ok: false;
  errors: ToolErrorItem[];
}

export function errorResponse(errors: ToolErrorItem[]): ToolErrorResponse {
  return { ok: false, errors };
}

export function singleError(
  field: string,
  expected: string,
  actual: string,
  hint: string,
): ToolErrorResponse {
  return { ok: false, errors: [{ field, expected, actual, hint }] };
}

// ============================================================
// SQLite 行类型
// ============================================================

export interface SummaryRow {
  id: string;
  novel_id: string;
  chapter: number;
  summary: string;
  characters: string; // JSON array
  events: string; // JSON array
  word_count: number | null;
  opening_snippet: string | null;
  ending_snippet: string | null;
  anchor_core: string | null;
  anchor_heartbeat: string | null;
  emotional_tone: string | null;
  continuation_hook: string; // JSON array
  timeline_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface FactRow {
  id: string;
  novel_id: string;
  subject: string;
  predicate: string;
  object: string;
  sector: string;
  from_chapter: number;
  /** NULL = 仍然有效；非 NULL = 从该章起失效（rollback 按它恢复） */
  invalidated_at_chapter: number | null;
  created_at: string;
  updated_at: string;
  /** 0=未知晓 / 1=本人已知晓，仅对 predicate='secret' 行有业务含义（片4 处境包/聊天滤网） */
  secret_known?: number | null;
}

export interface SettingRow {
  id: string;
  novel_id: string;
  content: string;
  sector: string;
  created_at: string;
  updated_at: string;
}

export interface FtsRow {
  content: string;
  source_table: string;
  source_id: string;
  novel_id: string;
  sector: string;
}

export interface ForeshadowingRegistryRow {
  novel_id: string;
  id: string;
  type: "small" | "medium" | "major";
  description: string;
  planted_chapter: number | null;
  /** 章号字符串（如 "120"）或卷级粗锚点（如 "vol-08"） */
  target_reveal: string | null;
  theme_link: string | null;
}

export interface ForeshadowingActionLogRow {
  novel_id: string;
  chapter: number;
  foreshadowing_id: string;
  action: "plant" | "develop" | "reveal";
  status: "planned" | "realized";
}

export interface ArcMetaRow {
  novel_id: string;
  arc_id: string;
  volume_no: number;
  title: string;
  chapter_start: number;
  chapter_end: number;
  core_question: string;
  irreversible_change: string;
  next_arc_seed: string;
  antagonist_agent: string | null;
  payoff_beats: string; // JSON array
}

export interface ArcSummaryRow {
  novel_id: string;
  scope: "arc" | "volume";
  scope_id: string;
  chapter_start: number;
  chapter_end: number;
  summary: string;
  created_at: string;
}

export interface CharacterCardRow {
  novel_id: string;
  character: string;
  as_of_chapter: number;
  card_json: string; // JSON object: predicate → 当前值
}

export interface StorylineRow {
  novel_id: string;
  id: string;
  name: string;
  type:
    | "main"
    | "growth"
    | "romance"
    | "faction"
    | "mystery"
    | "rivalry"
    | "world"
    | "other";
  priority: number;
  entry_chapter: number;
  planned_payoff_chapter: number | null;
  status: "active" | "dormant" | "resolved";
  /** 全书贯穿线标记（0/1）：1 = 该线进 WCP 常驻层，永不随卷滚动丢弃 */
  is_through_line: number;
}

export interface ChapterStorylineFocusRow {
  novel_id: string;
  chapter: number;
  storyline_id: string;
}

export interface ChapterReviewRow {
  novel_id: string;
  chapter: number;
  verdict: "pass" | "fail";
  issues_json: string; // JSON array of {severity, where, what, fix_hint}
  created_at: string;
}

export interface CandidateCharacterRow {
  novel_id: string;
  /** 落盘即铸定的 canonical 身份；建档时复用同一 UID（CharacterReference 契约） */
  character_uid: string;
  name: string;
  /** 一句话备注：作者留候选时记的「将来是谁/做什么用」（可空） */
  note: string | null;
  /** 首次被提及/计划出场的章号（可空） */
  proposed_chapter: number | null;
  /** 候选与已建档角色的初始关系草稿 JSON（[{other_character_uid, state}]）；转正建档时回写为正式关系。可空（旧行 / 未提供）。 */
  initial_relationships: string | null;
  /** 重要度（ADR-0023）：minor（次要，进池静默不提醒）/ major（重要，写完正文提醒建档）。一次性龙套不入本表。 */
  importance: "minor" | "major";
  source: "plan" | "write" | "manual";
  status: "candidate" | "promoted";
  created_at: string;
  updated_at: string;
}

// ============================================================
// 工具处理器类型
// ============================================================

export interface ToolContext {
  novelId: string;
  db: Database.Database;
  /**
   * 项目根目录（包含 outline/、manuscript/、bible/ 等子目录）。
   * 由 loadConfig 推导：dirname(configDir)。测试场景可为空串。
   */
  projectRoot: string;
  /** config.yaml 的篇幅参数（setup 写入；缺省 null） */
  estimatedTotalChapters?: number | null;
  /** config.yaml 的每章字数参数（setup 写入；缺省 null） */
  wordsPerChapter?: number | null;
  /** config.yaml 的风格档位：web_fast / web_standard / literary（缺省 null） */
  styleProfile?: string | null;
  /**
   * 无作者样章时是否自动取最近一章开场段当声音参考。**默认关闭**——自动取样拿的是 AI 自产正文，
   * 写手会学到上一章的句法病灶并逐章放大；显式 config.yaml `style_anchor_auto_fallback: true` 才开。
   */
  styleAnchorAutoFallback?: boolean;
  /** config.yaml 的题材自由文本（缺省 null）；仅供 resolveDriveBucket 关键词兜底判定用 */
  genre?: string | null;
  /** config.yaml 原文里是否出现过 voltage_bestof 字段（电压点判优已下线，仅用于旧配置一次性忽略提示） */
  voltageBestofPresentInConfig?: boolean;
  /**
   * 聊天只读滤网开关（片4，A4×D2 外审 P1-1）：env NARRACAT_CHAT_SECRET_FILTER=1 落入，
   * 仅角色聊天 MCP 代理路径设置；sdk-runner 写作链路绝不设，缺省 false（写作全可见）。
   */
  secretFilter?: boolean;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  ctx: ToolContext,
) => Promise<unknown>;
