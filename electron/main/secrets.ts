import keytar from 'keytar'
import { findUnsafeApiKeyCharacter, UNSAFE_API_KEY_MESSAGE } from './config.ts'
import type { ProviderId } from './config.ts'

const SERVICE = 'NarraCat'

function accountForProvider(provider: ProviderId): string {
  return `api-key:${provider}`
}

export async function hasApiKey(provider: ProviderId): Promise<boolean> {
  const key = await keytar.getPassword(SERVICE, accountForProvider(provider))
  return typeof key === 'string' && key.length > 0
}

export async function getApiKey(provider: ProviderId): Promise<string | null> {
  return keytar.getPassword(SERVICE, accountForProvider(provider))
}

export async function setApiKey(provider: ProviderId, apiKey: string): Promise<void> {
  const trimmed = apiKey.trim()
  if (trimmed.length < 8) {
    throw new Error('API Key 太短，请检查后重试。')
  }
  // 非 ASCII 字符（中文/全角等）会让请求头崩溃，源头拦下不入库。
  if (findUnsafeApiKeyCharacter(trimmed)) {
    throw new Error(UNSAFE_API_KEY_MESSAGE)
  }
  await keytar.setPassword(SERVICE, accountForProvider(provider), trimmed)
}

export async function deleteApiKey(provider: ProviderId): Promise<boolean> {
  return keytar.deletePassword(SERVICE, accountForProvider(provider))
}
