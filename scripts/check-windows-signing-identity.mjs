#!/usr/bin/env node
// Windows Authenticode 签名身份硬闸（与 mac check-signing-identity.mjs 同构，fail-loud）。
// CI 跳过检查的环境变量
if (process.env.SKIP_SIGNING_CHECK === 'true') {
  console.log('⚠️  SKIP_SIGNING_CHECK=true，跳过 Windows 签名身份检查')
  process.exit(0)
}

//
// electron-builder 在 Windows 上缺签名证书时的行为与 mac 同款：只告警不报错，静默产出
// 未签名安装包。Windows 未签名的 exe 会触发 SmartScreen「未知发布者」警告，用户必须
// 手动点击「更多信息 → 仍要运行」才能安装——内测种子用户可接受，正式分发不可接受。
// 故此处与 mac 的 Developer ID 闸对齐：Windows 出包档（bun run package:win）在第一步拦下。
//
// 判据：证书存在于当前用户证书存储（Cert:\CurrentUser\My）。
// 用 PowerShell Get-ChildItem 列举（powershell 在 Windows 全版本可用，无需额外依赖）：
//   Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.HasPrivateKey }
// 任何带私钥的代码签名类证书都算（Authenticode / CodeSigning EKU）。
// 也认环境变量 NARRACAT_WINDOWS_SIGNING_THUMBPRINT（CI 无交互取证书时用）。
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export const REQUIRED_CERT_SUBJECT_PREFIX = 'NarraCat'

const SETUP_GUIDE = [
  '未在当前用户证书存储（Cert:\CurrentUser\My）中找到可用的 Authenticode 代码签名证书。',
  'electron-builder 在缺证书时只告警不报错，会静默产出「未签名」的安装包——故此处硬闸拦下。',
  '',
  '只有打包分发（bun run package:win / bun run package:win:release）才需要这张证书；',
  '本机开发调试用 bun run dev 不打包、不签名，不受此闸影响。',
  '',
  '办证步骤（Windows 代码签名证书，EV 或 OV 均可）：',
  '  1. 从证书颁发机构（DigiCert / GlobalSign / 国内 CA）购买 Windows 代码签名证书，',
  '     导入到 当前用户 → 个人 证书存储（带私钥）。',
  '  2. 验证：Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.HasPrivateKey }',
  '  3. 或在 CI 中用环境变量 NARRACAT_WINDOWS_SIGNING_THUMBPRINT=<证书指纹> 指定证书，',
  '     配合 electron-builder 的 win.certificateFile / certificatePassword 配置。',
  '',
  'Windows 未签名 exe 的后果：SmartScreen「未知发布者」警告 + 部分杀软直接拦，',
  '种子用户安装受阻。',
].join('\n')

/** 从证书存储列出带私钥的代码签名证书指纹（SHA-1）。 */
export function listCodeSigningThumbprints({ exec = execFileSync } = {}) {
  const script = [
    'Get-ChildItem Cert:\CurrentUser\My -ErrorAction SilentlyContinue',
    '| Where-Object { $_.HasPrivateKey }',
    '| Select-Object -ExpandProperty Thumbprint',
  ].join(' ')
  const output = exec('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8' })
  return String(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function assertWindowsSigningIdentity({ exec = execFileSync, env = process.env } = {}) {
  const envThumbprint = String(env.NARRACAT_WINDOWS_SIGNING_THUMBPRINT ?? '').trim()
  if (envThumbprint) return [{ thumbprint: envThumbprint, source: 'env' }]

  const thumbprints = listCodeSigningThumbprints({ exec })
  if (thumbprints.length === 0) throw new Error(SETUP_GUIDE)
  return thumbprints.map((thumbprint) => ({ thumbprint, source: 'cert-store' }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const identities = assertWindowsSigningIdentity()
    for (const identity of identities) {
      console.log(`✓ Authenticode 签名身份：${identity.thumbprint}（${identity.source}）`)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
