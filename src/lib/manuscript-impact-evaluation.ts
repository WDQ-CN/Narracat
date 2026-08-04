/**
 * 把「用户手改正文后的记忆同步意图」拼成发给 /narracat:sync-chapter-memory 的 prompt。
 * 与立项卡第二档同模式（premise-impact-evaluation.ts）：改动本身已落盘，
 * 命令侧负责「影响报告 → 用户确认 → 回滚重抽 → 矛盾提示」，App 零引擎判断。
 */
export function buildSyncChapterMemoryPrompt({ chapter, reasons }: { chapter: number; reasons: string[] }): string {
  const reasonLine = reasons.length > 0 ? `这次改动的信号：${reasons.join('；')}。` : ''
  return [
    `我刚手动修改了第 ${chapter} 章正文，正文已保存。${reasonLine}`,
    '请对比当前正文与记忆库中本章已提取的事实，先把影响清单摆给我确认：哪些事实变了、哪些失效、后续哪些章可能出现矛盾。',
    '我确认后再回滚本章记忆、按新正文重新提取入库并做矛盾体检；我取消则不要动记忆。',
  ].join('\n')
}
