/**
 * 错误信息脱敏：把可能出现在 provider / SDK 错误文案里的认证材料打码，
 * 避免 API Key（sk-*）/ Bearer token 经由失败提示泄漏到 UI 或日志。
 *
 * 所有「把错误展示给用户」的路径共用此函数（Agent run、provider 连接测试、角色聊天失败气泡），
 * 保证脱敏口径一致、不再各处复制实现（#288 Codex P2）。
 */
export function redactErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***')
}
