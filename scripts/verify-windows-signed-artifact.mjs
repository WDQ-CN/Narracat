#!/usr/bin/env node
// Windows 打包后收尾校验（与 mac verify-signed-artifact.mjs 同构）。
// 验证 NSIS 安装器真的被 Authenticode 签名，且签名有效（未被篡改）。
// 用 PowerShell 的 Get-AuthenticodeSignature（Windows 全版本可用），不依赖 signtool 安装。
//
// 缺证书时 electron-builder 只告警不产出签名，前面的 check-windows-signing-identity 硬闸
// 已经拦下；这里补打包后一步：产物真的被签、签名真的有效（Status === Valid）。
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

/** 默认校验目标：electron-builder nsis 产物 dist/ 目录（不指定时取目录里最新 win-x64.exe）。 */
export const DEFAULT_WIN_INSTALLER_DIR = join(repoRoot, 'dist')
export const WIN_INSTALLER_PATTERN = /^NarraCat-\d+\.\d+\.\d+-win-x64\.exe$/

export function parseAuthenticodeStatus(output) {
  const text = String(output ?? '')
  return {
    status: (text.match(/Status\s*:\s*(\S+)/)?.[1] ?? '').trim(),
    signer: (text.match(/SignerCertificate\s*:\s*([^\r\n]+)/)?.[1] ?? '').trim(),
  }
}

function defaultExec(command, args) {
  return String(execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))
}

export function findLatestWinInstaller(distDir = DEFAULT_WIN_INSTALLER_DIR) {
  if (!existsSync(distDir)) return null
  const files = readdirSync(distDir).filter((name) => WIN_INSTALLER_PATTERN.test(name))
  if (files.length === 0) return null
  // 按版本号三段数值排序（字符串 sort 会把 0.1.100 排在 0.1.99 前面，取错旧版）
  files.sort((a, b) => {
    const va = a.match(/NarraCat-(\d+)\.(\d+)\.(\d+)-win-x64\.exe/)
    const vb = b.match(/NarraCat-(\d+)\.(\d+)\.(\d+)-win-x64\.exe/)
    if (!va || !vb) return 0
    for (let i = 1; i <= 3; i++) {
      const diff = Number(va[i]) - Number(vb[i])
      if (diff !== 0) return diff
    }
    return 0
  })
  return join(distDir, files[files.length - 1])
}

/**
 * 验证 Windows 安装器 Authenticode 签名。exec 可注入以便单测。
 * 找不到产物就 fail-loud（静默跳过 = 没验，等于没这道门）。
 */
export function verifyWindowsSignedArtifact({ installerPath, exec = defaultExec } = {}) {
  const resolved = installerPath ?? findLatestWinInstaller()
  if (!resolved || !existsSync(resolved)) {
    throw new Error(
      [
        `找不到 Windows 安装器产物：${resolved ?? DEFAULT_WIN_INSTALLER_DIR + '/*.exe'}`,
        '先跑 bun run package:win 打包，再用本脚本收尾校验。',
      ].join('\n'),
    )
  }

  const script = [
    'param($Path)',
    '$sig = Get-AuthenticodeSignature -FilePath $Path',
    'Write-Output "Status: $($sig.Status)"',
    'if ($sig.SignerCertificate) { Write-Output "SignerCertificate: $($sig.SignerCertificate.Subject)" }',
  ].join('; ')
  const output = exec('powershell', ['-NoProfile', '-Command', script, '-Path', resolved])
  const { status, signer } = parseAuthenticodeStatus(output)

  if (status !== 'Valid') {
    throw new Error(
      [
        `Authenticode 签名校验失败：Status=${status || '未找到 Status 行'}（期望 Valid）。`,
        '产物可能未签名、签名损坏、或被篡改。',
        `复核命令：powershell -NoProfile -Command "Get-AuthenticodeSignature -FilePath '\${resolved}'"`,
        output ? `原始输出：\n${output}` : '',
      ].filter(Boolean).join('\n'),
    )
  }
  if (!signer) {
    throw new Error(`签名证书信息缺失（SignerCertificate 未解析到）：\n${output}`)
  }
  return { status, signer, installerPath: resolved }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = verifyWindowsSignedArtifact()
    console.log(`✓ Authenticode 签名有效：${result.signer}`)
    console.log(`✓ 安装器：${result.installerPath}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
