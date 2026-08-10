#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const REQUIRED_IDENTITY_PREFIX = 'Developer ID Application'

const SETUP_GUIDE = [
  '未在钥匙串中找到 Developer ID Application 证书。',
  'electron-builder 在缺证书时只告警不报错，会静默产出「未签名」的包——故此处硬闸拦下。',
  '',
  '只有打包分发（bun run package / bun run package:release）才需要这张证书；',
  '本机开发调试用 bun run dev 不打包、不签名，不受此闸影响。',
  '',
  '办证步骤：',
  '  1. 钥匙串访问 → 证书助理 → 从证书颁发机构请求证书（存到磁盘，得到 .certSigningRequest）',
  '  2. developer.apple.com → Certificates, IDs & Profiles → Certificates → + →',
  '     选 Developer ID Application → 上传第 1 步的 CSR → 下载 .cer',
  '  3. 双击 .cer 装入钥匙串',
  '',
  '核对：security find-identity -v -p codesigning',
].join('\n')

/** 从 `security find-identity -v -p codesigning` 的输出中挑出可分发身份行。 */
export function findDeveloperIdIdentities(output) {
  return output
    .split('\n')
    .filter((line) => line.includes(`"${REQUIRED_IDENTITY_PREFIX}`))
    .map((line) => line.trim())
}

export function assertSigningIdentity({ exec = execFileSync } = {}) {
  const output = exec('security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' })
  const identities = findDeveloperIdIdentities(String(output))
  if (identities.length === 0) throw new Error(SETUP_GUIDE)
  return identities
}

/**
 * 从一行 `security find-identity` 身份行（形如 `2) 8E79D3...F803BA "Developer ID Application: ..."`）
 * 中解出证书 SHA-1 哈希，供 `codesign --sign <hash>` 使用。
 * 用哈希而非人名匹配：换机/换证书自动适配，且比名字子串匹配更精确（不会误撞同名前缀证书）。
 */
export function parseSigningIdentityHash(identityLine) {
  const match = String(identityLine ?? '').match(/^\d+\)\s+([0-9A-Fa-f]{40})\s+"/)
  if (!match) {
    throw new Error(`无法从签名身份行解析出证书哈希（期望形如 "N) <40位十六进制哈希> \\"..."）：${identityLine}`)
  }
  return match[1]
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const identities = assertSigningIdentity()
    console.log(`✓ 可分发签名身份：${identities.length} 个`)
    for (const identity of identities) console.log(`  ${identity}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
