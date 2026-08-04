/**
 * 能力卡正文分区 SSOT（刀3 卡格式：`[runtime]` 机制区 + `[evidence]` 摘录区）。
 * 与 electron/main/packs/pack-store.ts 的导出红线、pack-publish 的 learned-external
 * 剥离、text-reuse-scan 的扫描输入共用，勿在别处再写同款正则。
 */
export const EVIDENCE_SECTION_RE = /\[evidence\]([\s\S]*?)(?=\n\[|$)/g

/** 保留 `[evidence]` 标记行，清空段内容（导出清空 / learned-external 发布剥离用）。 */
export function stripEvidenceSections(body: string): string {
  return body.replace(EVIDENCE_SECTION_RE, '[evidence]\n')
}

/** 连同 `[evidence]` 标记整段移除，产出可供防抄袭扫描的非摘录正文。 */
export function extractNonEvidenceText(body: string): string {
  return body.replace(EVIDENCE_SECTION_RE, '')
}
