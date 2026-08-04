/**
 * 伏笔生命周期审计（维护者诊断用，只读不修改）
 *
 * 伏笔状态唯一记账在 foreshadowing_actions_log：
 * - duplicate_plant_action：同一伏笔在多个章节记了 plant 动作
 * - registry_planted_chapter_conflict：注册表埋设章号与最早实际 plant 不一致
 */
export function auditForeshadowingLifecycle(db, novelId, options = {}) {
    const wantedIds = new Set((options.foreshadowingIds ?? []).filter(Boolean));
    const shouldInclude = (id) => wantedIds.size === 0 ||
        Array.from(wantedIds).some((wantedId) => id === wantedId || id.startsWith(`${wantedId}-`));
    const registryPlants = db
        .prepare(`SELECT id, planted_chapter
         FROM foreshadowing_registry
         WHERE novel_id = ?
         ORDER BY id`)
        .all(novelId).filter((row) => shouldInclude(row.id) && row.planted_chapter !== null);
    const actionPlants = db
        .prepare(`SELECT foreshadowing_id, chapter, action, status
         FROM foreshadowing_actions_log
         WHERE novel_id = ? AND action = 'plant'
         ORDER BY foreshadowing_id, chapter, status`)
        .all(novelId).filter((row) => shouldInclude(row.foreshadowing_id));
    const ids = new Set();
    for (const row of registryPlants)
        ids.add(row.id);
    for (const row of actionPlants)
        ids.add(row.foreshadowing_id);
    const findings = [];
    for (const id of Array.from(ids).sort()) {
        const actionsForId = actionPlants.filter((row) => row.foreshadowing_id === id);
        const registryForId = registryPlants.find((row) => row.id === id);
        const actionChapters = uniqueSortedNumbers(actionsForId.map((row) => row.chapter));
        if (actionChapters.length > 1) {
            findings.push({
                foreshadowing_id: id,
                issue_type: "duplicate_plant_action",
                chapters: actionChapters,
                duplicate_actions: actionsForId.map((row) => ({
                    source: "foreshadowing_actions_log",
                    chapter: row.chapter,
                    action: "plant",
                    status: row.status,
                })),
                suggestion: "保留最早章节的 plant action；后续章节应按 develop 或 reveal 重新记录，若无法判断实际动作，先删除/忽略后续 plant action 并人工复核章节正文。",
            });
        }
        const realizedChapters = uniqueSortedNumbers(actionsForId.filter((row) => row.status === "realized").map((row) => row.chapter));
        const earliestRealizedPlant = realizedChapters[0];
        if (registryForId?.planted_chapter !== null &&
            registryForId?.planted_chapter !== undefined &&
            earliestRealizedPlant !== undefined &&
            registryForId.planted_chapter !== earliestRealizedPlant) {
            findings.push({
                foreshadowing_id: id,
                issue_type: "registry_planted_chapter_conflict",
                chapters: uniqueSortedNumbers([registryForId.planted_chapter, earliestRealizedPlant]),
                duplicate_actions: [
                    {
                        source: "foreshadowing_registry",
                        chapter: registryForId.planted_chapter,
                        action: "register",
                    },
                    {
                        source: "foreshadowing_actions_log",
                        chapter: earliestRealizedPlant,
                        action: "plant",
                    },
                ],
                suggestion: "registry.planted_chapter 应指向最早真实 plant 章节；若后续 register 覆盖了 planted_chapter，手动恢复为最早章节并保留后续章节为 develop/reveal。",
            });
        }
    }
    return {
        status: "ok",
        novel_id: novelId,
        checked_ids: Array.from(ids).sort(),
        findings,
        summary: {
            checked_ids: ids.size,
            findings: findings.length,
            duplicate_plant_actions: findings.filter((finding) => finding.issue_type === "duplicate_plant_action").length,
            registry_planted_chapter_conflicts: findings.filter((finding) => finding.issue_type === "registry_planted_chapter_conflict").length,
        },
    };
}
export function formatForeshadowingLifecycleAuditReport(report) {
    const lines = [
        "# Foreshadowing Lifecycle Audit",
        "",
        `Novel ID: ${report.novel_id}`,
        `Summary: ${report.summary.findings} findings across ${report.summary.checked_ids} foreshadowing ids`,
        `Breakdown: ${report.summary.duplicate_plant_actions} duplicate plant actions, ${report.summary.registry_planted_chapter_conflicts} registry conflicts`,
        "",
        "## Findings",
    ];
    if (report.findings.length === 0) {
        lines.push("- None");
    }
    else {
        for (const finding of report.findings) {
            lines.push(`- ${finding.foreshadowing_id} [${finding.issue_type}] chapters=${finding.chapters.join(", ")}`);
            for (const action of finding.duplicate_actions) {
                const status = action.status ? ` status=${action.status}` : "";
                lines.push(`  - ${action.source} chapter=${action.chapter} action=${action.action}${status}`);
            }
            lines.push(`  - suggestion: ${finding.suggestion}`);
        }
    }
    lines.push("", "## Policy", "- Dry-run only: this report does not modify NovelMemory.", "- Keep one earliest plant/register source per foreshadowing id.", "- Later touches must be logged as develop or reveal after checking the manuscript.");
    return `${lines.join("\n")}\n`;
}
function uniqueSortedNumbers(values) {
    return Array.from(new Set(values.filter((value) => Number.isFinite(value)))).sort((a, b) => a - b);
}
