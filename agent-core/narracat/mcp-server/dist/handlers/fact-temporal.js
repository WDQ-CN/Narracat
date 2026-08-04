/**
 * 事实时序折叠的共享判定（ADR-0025 轻量双时间轴）
 *
 * 所有「取截至某章的最新有效事实」的折叠点共用同一套 event 轴判定，避免 reader / writer
 * 两份逻辑漂移（ADR-0025 / PR #325 审核 P2）。默认 event_chapter = from_chapter → 零回归；
 * 倒叙 fact（event < ingestion）按 event 轴召回与排序才正确。
 *
 * 注意：仅「时点回溯 / 当前值折叠」用 event 轴；rollback（回滚写作进度）与抽取脚手架
 * known_facts_summary（前文已记录）按 ingestion（from_chapter）判定，不用本片段。
 */
/** WHERE 片段：截至 at 章 event 轴生效且未失效。占位符顺序 = (at, at)。 */
export const FACT_VALID_AT_SQL = "COALESCE(event_chapter, from_chapter) <= ? AND (invalidated_at_chapter IS NULL OR invalidated_at_chapter > ?)";
/**
 * ORDER BY 尾段：event 轴「最新优先」；同章平手由 source 打破——authored（作者钦定/纠错）
 * 压过 extracted（正文抽取），spec §3.3。ingestion 与 created_at 兜底打破剩余平手；
 * created_at 秒精度下同章同秒双写仍可能打平（如同章先后两次 authored backfill），
 * facts 是普通表天然带 rowid（插入序单调递增），末位再兜底一层 rowid DESC 保证确定性
 * 赢家=后插者，不出现「同章双 authored 无确定性排序」的非确定性折叠（PR#454 评审 F6）。
 */
export const FACT_LATEST_ORDER_SQL = "COALESCE(event_chapter, from_chapter) DESC, CASE WHEN source = 'authored' THEN 1 ELSE 0 END DESC, from_chapter DESC, created_at DESC, rowid DESC";
/** JS 侧 event 轴有效性判定（取全量历史再过滤的场景，如 novel_relationship）。 */
export function isFactValidAt(row, at) {
    const eventCh = row.event_chapter ?? row.from_chapter;
    return eventCh <= at && (row.invalidated_at_chapter === null || row.invalidated_at_chapter > at);
}
/**
 * 聊天只读滤网（片4，A4×D2 外审 P1-1）：未打标「本人已知晓」的 secret 事实不可见。
 *
 * 只对聊天 MCP 代理路径生效（ctx.secretFilter，由 env NARRACAT_CHAT_SECRET_FILTER=1 落入）；
 * sdk-runner 写作链路（memory-keeper 等）绝不设该 env，ctx.secretFilter 恒为 false，本判据
 * 全程不介入——宁可漏（模型答不出未知晓的秘密）不可剧透。
 */
export const SECRET_FILTER_SQL = `NOT (predicate = 'secret' AND COALESCE(secret_known, 0) = 0)`;
/**
 * JS 侧秘密滤网判定（检索命中回表装配处专用，如 novel_query 的 getSourceDetail）：
 * secretFilterOn 为真且该行是未打标 secret 时返回 true（调用方应将其视为不可见）。
 */
export function isSecretHiddenForChat(row, secretFilterOn) {
    return secretFilterOn && row.predicate === "secret" && !(row.secret_known ?? 0);
}
/**
 * 恢复被 revokedId 打倒的受害行（取代者被撤销/删除后，受害者复活）。
 * 用于 authored_state 的 retract/correct 事务内（取代者本身被撤回时受害者理应复活，评审 C1），
 * 以及 rollback 对「取代者被删但受害行 invalidated_at_chapter 早于回滚点」这类悬垂指针的
 * 兜底修复（评审 I2）——两处共用同一条恢复语义，避免漂移。返回本次恢复的行数。
 */
export function revalidateVictimsOf(db, novelId, revokedId) {
    return db
        .prepare(`UPDATE facts SET invalidated_at_chapter = NULL, invalidated_by = NULL, updated_at = datetime('now')
       WHERE novel_id = ? AND invalidated_by = ?`)
        .run(novelId, revokedId).changes;
}
