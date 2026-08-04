/**
 * 角色聊天头像与时间的纯展示工具。
 *
 * 角色没有图片素材，头像 = 名字首字 + 统一品牌底色——与联系人列表 / 角色资料卡是**同一个来源**
 * （品牌样式 bg-brand/10 text-brand 由组件层提供，本模块只给首字，不另算颜色，避免配色分叉）。
 * 时间统一渲染为 24h HH:mm。
 */

/** 头像首字：取名字第一个码点，空名兜底「角」。 */
export function avatarInitial(name: string): string {
  return [...name.trim()][0] ?? '角'
}

/** ISO 时间 → 本地 24h HH:mm；无法解析时返回空串（不渲染时间，不显示占位噪声）。 */
export function formatChatTime(value: string | null | undefined): string {
  if (!value) return ''
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
}
