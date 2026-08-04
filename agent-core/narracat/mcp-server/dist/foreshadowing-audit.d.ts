/**
 * 伏笔生命周期审计（维护者诊断用，只读不修改）
 *
 * 伏笔状态唯一记账在 foreshadowing_actions_log：
 * - duplicate_plant_action：同一伏笔在多个章节记了 plant 动作
 * - registry_planted_chapter_conflict：注册表埋设章号与最早实际 plant 不一致
 */
import type Database from "better-sqlite3";
export type ForeshadowingLifecycleIssueType = "duplicate_plant_action" | "registry_planted_chapter_conflict";
export interface ForeshadowingLifecycleEvent {
    source: "foreshadowing_actions_log" | "foreshadowing_registry";
    chapter: number;
    action: "plant" | "register";
    status?: string;
}
export interface ForeshadowingLifecycleFinding {
    foreshadowing_id: string;
    issue_type: ForeshadowingLifecycleIssueType;
    chapters: number[];
    duplicate_actions: ForeshadowingLifecycleEvent[];
    suggestion: string;
}
export interface ForeshadowingLifecycleAuditReport {
    status: "ok";
    novel_id: string;
    checked_ids: string[];
    findings: ForeshadowingLifecycleFinding[];
    summary: {
        checked_ids: number;
        findings: number;
        duplicate_plant_actions: number;
        registry_planted_chapter_conflicts: number;
    };
}
export declare function auditForeshadowingLifecycle(db: Database.Database, novelId: string, options?: {
    foreshadowingIds?: string[];
}): ForeshadowingLifecycleAuditReport;
export declare function formatForeshadowingLifecycleAuditReport(report: ForeshadowingLifecycleAuditReport): string;
