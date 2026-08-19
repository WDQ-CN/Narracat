import { describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  findLatestWinInstaller,
  parseAuthenticodeStatus,
  verifyWindowsSignedArtifact,
} from './verify-windows-signed-artifact.mjs'

const VALID_OUTPUT = [
  'Status: Valid',
  'SignerCertificate: CN=NarraCat Dev, O=NarraCat, C=CN',
  '',
].join('\n')

const NOT_SIGNED_OUTPUT = ['Status: NotSigned', ''].join('\n')

describe('Windows Authenticode 收尾校验', () => {
  test('解析 Get-AuthenticodeSignature 输出', () => {
    expect(parseAuthenticodeStatus(VALID_OUTPUT)).toEqual({
      status: 'Valid',
      signer: 'CN=NarraCat Dev, O=NarraCat, C=CN',
    })
    expect(parseAuthenticodeStatus(NOT_SIGNED_OUTPUT)).toEqual({
      status: 'NotSigned',
      signer: '',
    })
  })

  test('Valid 签名通过，返回签名者与安装器路径', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'narracat-win-verify-'))
    const installer = join(dir, 'NarraCat-0.1.9999-win-x64.exe')
    await writeFile(installer, 'MZ fake exe\n')
    try {
      const exec = () => VALID_OUTPUT
      const result = verifyWindowsSignedArtifact({ installerPath: installer, exec })
      expect(result.status).toBe('Valid')
      expect(result.signer).toContain('NarraCat')
      expect(result.installerPath).toBe(installer)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('NotSigned 时 fail-loud（未签名 = SmartScreen 会拦，等于没这道门）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'narracat-win-verify-'))
    const installer = join(dir, 'NarraCat-0.1.9999-win-x64.exe')
    await writeFile(installer, 'MZ fake exe\n')
    try {
      expect(() => verifyWindowsSignedArtifact({ installerPath: installer, exec: () => NOT_SIGNED_OUTPUT })).toThrow(
        /Status=NotSigned/,
      )
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('找不到产物时 fail-loud，绝不静默跳过', () => {
    expect(() => verifyWindowsSignedArtifact({ installerPath: '/nonexistent/NarraCat.exe' })).toThrow(/找不到/)
  })

  test('findLatestWinInstaller 按版本号取最新', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'narracat-win-latest-'))
    await writeFile(join(dir, 'NarraCat-0.1.100-win-x64.exe'), 'a\n')
    await writeFile(join(dir, 'NarraCat-0.1.99-win-x64.exe'), 'b\n')
    await writeFile(join(dir, 'NarraCat-0.1.100-mac-arm64.dmg'), 'c\n')
    await writeFile(join(dir, 'unrelated.txt'), 'd\n')
    try {
      expect(findLatestWinInstaller(dir)).toBe(join(dir, 'NarraCat-0.1.100-win-x64.exe'))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('win 安装器产物存在性探测', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'narracat-win-exists-'))
    const installer = join(dir, 'NarraCat-0.1.9999-win-x64.exe')
    expect(existsSync(installer)).toBe(false)
    await writeFile(installer, 'MZ\n')
    expect(existsSync(installer)).toBe(true)
    await rm(dir, { recursive: true, force: true })
  })
})
