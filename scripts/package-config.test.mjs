import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const appIconSvg = readFileSync('build/icon.svg', 'utf8')

describe('RC package configuration', () => {
  test('uses the NarraCat app identity for packaged builds', () => {
    expect(packageJson.productName).toBe('NarraCat')
    expect(packageJson.build.appId).toBe('app.narracat.desktop')
  })

  test('targets ad-hoc signed macOS arm64 DMG artifacts', () => {
    expect(packageJson.scripts.package).toBe('node scripts/package-rc.mjs')
    expect(packageJson.build.artifactName).toBe('NarraCat-${version}-mac-${arch}.${ext}')
    // ad-hoc 签名(非 null=完全不签):修复 identity:null 留下的坏 Electron 继承签名 → "已损坏"
    // 无法右键打开的死局;ad-hoc 让签名有效(可被授权打开),非公证故仍需 Gatekeeper 授权教程(#352)。
    expect(packageJson.build.mac.identity).toBe('-')
    // 不开 hardened runtime:非公证 ad-hoc 分发避免跨机库校验拦截原生模块/headless node。
    expect(packageJson.build.mac.hardenedRuntime).toBe(false)
    expect(packageJson.build.mac.target).toEqual([{ target: 'dmg', arch: ['arm64'] }])
  })

  test('uses a pure white DMG installer background', () => {
    expect(packageJson.build.dmg.backgroundColor).toBe('#ffffff')
  })

  test('uses a pure white rounded app icon background', () => {
    expect(appIconSvg).toContain('<rect width="512" height="512" rx="96" fill="#FFFFFF"/>')
  })

  test('keeps only the Electron locales used by the RC app', () => {
    expect(packageJson.build.electronLanguages).toEqual(['zh_CN', 'en'])
  })

  test('packages only built runtime output into app.asar', () => {
    expect(packageJson.build.files).toEqual(['out/**', '!out/**/*.map'])
    expect(packageJson.build.files).not.toContain('node_modules/**')
    expect(packageJson.build.files).not.toContain('src/**')
    expect(packageJson.build.files).not.toContain('electron/**')
  })

  test('拆旧刀5：claude-sdk 打包资产全退役（无 SDK unpack、无 headless runtime 资源）', () => {
    expect(packageJson.build.asarUnpack).not.toContain('node_modules/@anthropic-ai/claude-agent-sdk/**')
    expect(JSON.stringify(packageJson.build.extraResources)).not.toContain('NarraCatAgentRuntime')
    expect(JSON.stringify(packageJson.dependencies)).not.toContain('claude-agent-sdk')
    // 原生模块仍需 unpack（N-API better-sqlite3）
    expect(packageJson.build.asarUnpack).toContain('node_modules/better-sqlite3/**')
  })

  test('bundles the whitelisted Agent Core stage, not the raw source dir', () => {
    // 根因修复（ADR-0026）：从过滤后的 build/NarraCatAgentCore 打包，
    // 不再直指 agent-core/narracat 源目录（那会外发 eval/CHANGELOG/docs/测试等研发痕迹）。
    expect(packageJson.build.extraResources).toContainEqual({
      from: 'build/NarraCatAgentCore',
      to: 'NarraCatAgentCore',
    })
    expect(packageJson.build.extraResources).not.toContainEqual({
      from: 'agent-core/narracat',
      to: 'NarraCatAgentCore',
    })
  })
})
