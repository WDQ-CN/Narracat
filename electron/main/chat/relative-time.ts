/**
 * 角色聊天「时间感」用的相对时长格式化（纯函数，可单测）。
 * 只描述"隔了多久"，给跨度标注与时间锚点共用；不做"X 前"这种绝对锚点。
 */

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

/** 历史相邻消息间隔超过该值才插时间标注 / 才加锚点（小于则视为连续对话，不标）。 */
export const CHAT_GAP_LABEL_THRESHOLD_MS = 6 * HOUR_MS

/** 把毫秒间隔转成自然中文时长短语。 */
export function formatChatGap(deltaMs: number): string {
  if (deltaMs <= 0) return '一会儿'
  if (deltaMs < DAY_MS) {
    const hours = Math.floor(deltaMs / HOUR_MS)
    return hours <= 0 ? '一会儿' : `${hours} 小时`
  }
  const days = Math.floor(deltaMs / DAY_MS)
  if (days === 1) return '一天'
  if (days < 7) return `${days} 天`
  if (days < 14) return '一周多'
  if (days < 30) return `${Math.floor(days / 7)} 周`
  if (days < 365) return `${Math.floor(days / 30)} 个月`
  return '很久'
}
