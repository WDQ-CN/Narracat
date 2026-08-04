/**
 * 角色聊天画像 IPC 边界校验（独立模块，供测试直接导入，无重型依赖）。
 */

export function normalizeSaveProfileInput(input: unknown): {
  scope: 'author' | 'impression'
  content: string
  projectPath: string
  characterUid: string
} {
  if (!input || typeof input !== 'object') throw new Error('画像保存参数非法。')
  const { scope, content, projectPath, characterUid } = input as Record<string, unknown>
  if (scope !== 'author' && scope !== 'impression') throw new Error('画像 scope 非法。')
  if (typeof content !== 'string') throw new Error('画像内容非法。')
  if (typeof projectPath !== 'string' || !projectPath.trim()) throw new Error('缺少项目路径。')
  if (typeof characterUid !== 'string' || !characterUid.trim()) throw new Error('缺少 character_uid。')
  return { scope, content, projectPath, characterUid: characterUid.trim() }
}
