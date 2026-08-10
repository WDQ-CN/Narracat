#!/usr/bin/env node
// 自动化 §6.1 的「打包后收尾校验」（原设计文档只写了手动命令——手动的东西会被跳过）。
// electron-builder 在缺公证凭证时是 warn + exit 0 静默跳过公证（app-builder-lib/out/macPackager.js ~509 行），
// 打包前的 env 硬闸（assertNotarizeCredentials）只能拦「没配凭证」，拦不住「配了但公证本身失败/被跳过」。
// 这里补上打包后一步：产物真的被签、真的被公证、票据真的装订了没有。
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { DEFAULT_DIST_DIR, resolveDmgPath } from './notarize-dmg.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

export const DEFAULT_APP_PATH = join(repoRoot, 'dist', 'mac-arm64', 'NarraCat.app')

/** 解析 `codesign -dv --verbose=4` 的输出（该命令把详情打到 stderr，不是 stdout）。 */
export function parseCodesignOutput(output) {
  const text = String(output ?? '')
  const authorityMatch = text.match(/^Authority=(.+)$/m)
  // 必须锚定到 CodeDirectory 行：真实输出里 flags= 出现在行中间（不在行首），
  // 且同一份输出还会有一行「Executable Segment flags=0x1」，不能把它误当成 hardened runtime 的判据。
  const flagsMatch = text.match(/^CodeDirectory\b.*?\bflags=(\S+)/m)
  return {
    authority: authorityMatch ? authorityMatch[1].trim() : null,
    hasRuntimeFlag: flagsMatch ? /\bruntime\b/.test(flagsMatch[1]) : false,
  }
}

/** 解析 `spctl -a -vvv -t install` 的输出（同样打到 stderr）。 */
export function parseSpctlOutput(output) {
  const text = String(output ?? '')
  return {
    accepted: /\baccepted\b/.test(text),
    // 必须锚定 `source=` 整行且明确排除 Unnotarized：
    // 未公证时真实输出是「source=Unnotarized Developer ID」，它包含子串「notarized Developer ID」，
    // 旧写法 /Notarized Developer ID/ 只因大小写不同才没有把 Unnotarized 误判为已公证。
    notarized: /^source=Notarized Developer ID$/m.test(text),
  }
}

function defaultExec(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error }
}

function combinedOutput(result) {
  return `${result.stdout}${result.stderr}`
}

/**
 * 组装 §6.1 机器验证四条为一次调用。exec 可注入以便单测不依赖本机真有已打包的产物。
 * 每条失败都抛出「现象 + 下一步怎么查」的错误，不是裸 assertion failed。
 */
export function verifySignedArtifact({
  appPath = DEFAULT_APP_PATH,
  dmgPath,
  distDir = DEFAULT_DIST_DIR,
  notarized = false,
  exec = defaultExec,
} = {}) {
  // 1. 签名身份 + hardened runtime 是否真的生效
  const dv = exec('codesign', ['-dv', '--verbose=4', appPath])
  const { authority, hasRuntimeFlag } = parseCodesignOutput(combinedOutput(dv))
  if (!authority || !authority.startsWith('Developer ID Application')) {
    throw new Error(
      [
        `签名身份校验失败：Authority 不是 Developer ID Application（实际：${authority ?? '未找到 Authority 行'}）。`,
        '可能是 ad-hoc 签名、开发证书误签，或钥匙串里没有正确的证书。',
        `复核命令：codesign -dv --verbose=4 "${appPath}"`,
        combinedOutput(dv) ? `原始输出：\n${combinedOutput(dv)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  if (!hasRuntimeFlag) {
    throw new Error(
      [
        'Hardened Runtime 未生效：codesign 输出的 flags 不含 runtime。',
        '检查 package.json build.mac.hardenedRuntime 是否为 true，以及是否用的是本次刚打包的新产物（旧产物会误报）。',
        `复核命令：codesign -dv --verbose=4 "${appPath}"`,
      ].join('\n'),
    )
  }

  // 2. 签名完整性（含所有内嵌资源/子组件）
  const verify = exec('codesign', ['--verify', '--deep', '--strict', appPath])
  if (verify.status !== 0) {
    throw new Error(
      [
        `签名完整性校验失败：codesign --verify --deep --strict 非零退出（status=${verify.status}）。`,
        '说明签名链或某个内嵌资源被篡改/损坏，常见于打包完成后又手动改动了 .app 内容。',
        `复核命令：codesign --verify --deep --strict --verbose=2 "${appPath}"`,
        combinedOutput(verify) ? `原始输出：\n${combinedOutput(verify)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  if (!notarized) return { authority, hasRuntimeFlag, notarized: false }

  // 3. Gatekeeper 视角：公证真的通过了
  const spctl = exec('spctl', ['-a', '-vvv', '-t', 'install', appPath])
  const { accepted, notarized: spctlNotarized } = parseSpctlOutput(combinedOutput(spctl))
  if (!accepted || !spctlNotarized) {
    throw new Error(
      [
        `公证校验失败：spctl 输出未同时满足 accepted 与 Notarized Developer ID（accepted=${accepted}, notarized=${spctlNotarized}）。`,
        '可能是公证请求未提交、被 Apple 拒绝，或提交后没等公证跑完就打包验证——electron-builder 缺凭证时会静默跳过公证，此现象正是那条防线。',
        `复核命令：spctl -a -vvv -t install "${appPath}"；查历史提交状态：xcrun notarytool history --apple-id ...（或用配置的 API Key）`,
        combinedOutput(spctl) ? `原始输出：\n${combinedOutput(spctl)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  // 4. 票据是否已装订（决定断网时能否直接打开）
  const stapler = exec('xcrun', ['stapler', 'validate', appPath])
  if (stapler.status !== 0) {
    throw new Error(
      [
        `票据装订校验失败：xcrun stapler validate 非零退出（status=${stapler.status}）。`,
        '公证本身可能通过了但票据没装订上产物，网友断网首次打开会失败。',
        `复核命令：xcrun stapler validate "${appPath}"`,
        combinedOutput(stapler) ? `原始输出：\n${combinedOutput(stapler)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  // electron-builder 只签名 + 公证 .app，dmg 容器本身默认不处理（DmgOptions.sign 默认 false）。
  // 用户先接触的是 dmg——.app 过了不代表 dmg 过了，此处必须显式再验一遍，找不到 dmg 就 fail-loud
  // （静默跳过 = 没验，等于没这道门）。
  const resolvedDmgPath = resolveDmgPath(dmgPath, distDir)

  // 5. dmg 容器：Gatekeeper 视角公证是否通过
  const dmgSpctl = exec('spctl', ['-a', '-vvv', '-t', 'install', resolvedDmgPath])
  const { accepted: dmgAccepted, notarized: dmgNotarized } = parseSpctlOutput(combinedOutput(dmgSpctl))
  if (!dmgAccepted || !dmgNotarized) {
    throw new Error(
      [
        `dmg 容器公证校验失败：spctl 输出未同时满足 accepted 与 Notarized Developer ID（accepted=${dmgAccepted}, notarized=${dmgNotarized}）。`,
        'electron-builder 不公证 dmg 容器本身，这一步依赖 scripts/notarize-dmg.mjs 补上——检查该脚本是否成功跑过。',
        `复核命令：spctl -a -vvv -t install "${resolvedDmgPath}"`,
        combinedOutput(dmgSpctl) ? `原始输出：\n${combinedOutput(dmgSpctl)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  // 6. dmg 容器：票据是否已装订
  const dmgStapler = exec('xcrun', ['stapler', 'validate', resolvedDmgPath])
  if (dmgStapler.status !== 0) {
    throw new Error(
      [
        `dmg 票据装订校验失败：xcrun stapler validate 非零退出（status=${dmgStapler.status}）。`,
        'dmg 容器公证本身可能通过了但票据没装订上，网友断网首次挂载 dmg 会失败。',
        `复核命令：xcrun stapler validate "${resolvedDmgPath}"`,
        combinedOutput(dmgStapler) ? `原始输出：\n${combinedOutput(dmgStapler)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }

  return { authority, hasRuntimeFlag, notarized: true, dmgPath: resolvedDmgPath }
}

function parseCliArgs(argv) {
  let notarized = false
  let appPath = DEFAULT_APP_PATH
  let dmgPath
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--notarized') notarized = true
    else if (argv[i] === '--app') {
      appPath = argv[i + 1]
      i += 1
    } else if (argv[i] === '--dmg') {
      dmgPath = argv[i + 1]
      i += 1
    }
  }
  return { notarized, appPath, dmgPath }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { notarized, appPath, dmgPath } = parseCliArgs(process.argv.slice(2))
    const result = verifySignedArtifact({ appPath, dmgPath, notarized })
    console.log(`✓ 签名身份：${result.authority}`)
    console.log('✓ Hardened Runtime：已启用')
    if (result.notarized) console.log(`✓ 公证已通过，票据已装订（app + dmg：${result.dmgPath}）`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
