/**
 * 正文字数口径（纯文字）。
 *
 * 用户设定「每章字数」时按纯文字计——只数文字（汉字 / 字母 / 数字），不含标点与空白。
 * 显示、统计、写作目标全链共用这一口径，避免「设 3000 却显示 3500」的漂移感。
 *
 * 注意：引擎侧 `agent-core/narracat/mcp-server/src/handlers/state-sync.ts` 的 `countWords`
 * 写 state.yaml / chapter_summaries 的权威字数，必须与本函数保持同口径（两处独立 build，
 * 改一处务必同步另一处）。
 */
export function countBodyChars(text: string): number {
  // 剔除空白（\s 含全角空格 U+3000）、标点（\p{P}：中英文逗号句号引号括号破折号省略号…）、
  // 符号（\p{S}：～￥° 等），剩下的就是文字本身。
  return text.replace(/[\s\p{P}\p{S}]/gu, '').length
}
