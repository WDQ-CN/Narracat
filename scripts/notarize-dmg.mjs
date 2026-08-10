#!/usr/bin/env node
// dmg 容器公证收尾：electron-builder 只签名+公证 .app（DmgOptions.sign 默认 false），
// dmg 容器本身不处理——用户先接触的是 dmg，未处理的 dmg 双击时 Gatekeeper 提示更吓人
// （实测：spctl 报 rejected / source=no usable signature）。
// 本脚本把手工验证过有效的三步固化：codesign 补签名 dmg → notarytool 提交并等待 → stapler 装订票据。
// 2026-08-10 对 dist/NarraCat-0.1.1869-mac-arm64.dmg 实测通过（status: Accepted，票据装订成功）。
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { assertSigningIdentity, parseSigningIdentityHash } from './check-signing-identity.mjs'
import { assertNotarizeCredentials, loadEnvFiles } from './package-rc.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')

export const DEFAULT_DIST_DIR = join(repoRoot, 'dist')

/**
 * 从 dist/ 下的 `{ name, mtimeMs }` 条目中挑最新修改的一个。
 * 不能按文件名字典序排——版本号是 git 提交数（如 1868 vs 1869），字典序在跨位数时会出错。
 */
export function pickLatestDmg(entries) {
  if (!entries || entries.length === 0) {
    throw new Error(
      'dist/ 下未找到任何 .dmg 文件，无法自动选择目标——请先跑一次打包（bun run package:release 等），或用 --dmg 指定路径。',
    )
  }
  return entries.reduce((latest, entry) => (entry.mtimeMs > latest.mtimeMs ? entry : latest))
}

/** 解析出目标 dmg 的绝对路径：显式给了 dmgArg 就用它，否则在 distDir 下自动挑最新修改的 .dmg。
 * 找不到就 fail-loud（不静默跳过，静默跳过等于没验/没处理）。也被 verify-signed-artifact.mjs 复用。 */
export function resolveDmgPath(dmgArg, distDir = DEFAULT_DIST_DIR) {
  if (dmgArg) return resolve(dmgArg)
  let files
  try {
    files = readdirSync(distDir, { withFileTypes: true })
  } catch {
    throw new Error(`dist 目录不存在或不可读：${distDir}——请先打包，或用 --dmg 指定 dmg 路径。`)
  }
  const entries = files
    .filter((entry) => entry.isFile() && entry.name.endsWith('.dmg'))
    .map((entry) => {
      const fullPath = join(distDir, entry.name)
      return { name: fullPath, mtimeMs: statSync(fullPath).mtimeMs }
    })
  return pickLatestDmg(entries).name
}

/** 组装 `notarytool submit --wait` 的完整输出，解出 submission id 与最终 status。 */
export function parseNotarytoolSubmitOutput(output) {
  const text = String(output ?? '')
  const idMatch = text.match(/^\s*id:\s*(\S+)/m)
  const statusMatch = text.match(/^\s*status:\s*(.+)$/m)
  return {
    submissionId: idMatch ? idMatch[1].trim() : null,
    status: statusMatch ? statusMatch[1].trim() : null,
  }
}

function defaultExec(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error }
}

function combinedOutput(result) {
  return `${result.stdout ?? ''}${result.stderr ?? ''}`
}

/** 把 { command, args } → { stdout,stderr,status } 的 exec 适配成 assertSigningIdentity 期望的
 * execFileSync 风格（成功返回 stdout 字符串，失败抛错）。 */
function toExecFileSyncStyle(exec) {
  return (command, args) => {
    const result = exec(command, args)
    if (result.status !== 0) {
      throw new Error(`${command} ${args.join(' ')} 退出码 ${result.status}：${combinedOutput(result)}`)
    }
    return result.stdout
  }
}

function isAlreadyStapled(dmgPath, exec) {
  return exec('xcrun', ['stapler', 'validate', dmgPath]).status === 0
}

/**
 * dmg 容器补签名 + 公证 + 装订票据。三步均已在真机手工验证有效（见脚本头注释）。
 * exec 可注入以便单测/预演不实际调用系统命令或消耗公证配额。
 */
export function notarizeDmg({
  dmgPath: dmgArg,
  distDir = DEFAULT_DIST_DIR,
  exec = defaultExec,
  env = process.env,
  log = console.log,
} = {}) {
  const dmgPath = resolveDmgPath(dmgArg, distDir)
  log(`✓ 目标 dmg：${dmgPath}`)

  if (isAlreadyStapled(dmgPath, exec)) {
    log('✓ 该 dmg 已装订公证票据，跳过（幂等：避免重复消耗公证配额）')
    return { dmgPath, skipped: true }
  }

  assertNotarizeCredentials(env)

  const identities = assertSigningIdentity({ exec: toExecFileSyncStyle(exec) })
  if (identities.length > 1) {
    log(`⚠ 钥匙串中找到 ${identities.length} 个 Developer ID Application 证书，静默选第一个可能与 electron-builder 给 .app 选中的不是同一张（app 与 dmg 用不同身份签）：`)
    for (const identity of identities) log(`  ${identity}`)
  }
  const hash = parseSigningIdentityHash(identities[0])
  log(`✓ 签名身份：${identities[0]}`)

  log('→ [1/3] codesign 对 dmg 补签名…')
  // --force 必须带：本脚本设计上就要支持「公证被拒/中断后重跑」，重跑时 dmg 已有上一轮的签名，
  // 不带 --force 会报 "is already signed"，且失败文案会指向证书/挂载等无关方向，把人带偏。
  const sign = exec('codesign', ['--sign', hash, '--force', '--timestamp', dmgPath])
  if (sign.status !== 0) {
    throw new Error(
      [
        `dmg 签名失败：codesign --sign ${hash} --force --timestamp "${dmgPath}"（退出码 ${sign.status}）`,
        '常见原因：钥匙串证书被移除/过期，或 dmg 正被其他进程占用（如 Finder 挂载中）。',
        `复核命令：codesign -dv --verbose=4 "${dmgPath}"`,
        combinedOutput(sign) ? `原始输出：\n${combinedOutput(sign)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  log('✓ [1/3] dmg 签名完成')

  log('→ [2/3] 提交 Apple 公证（notarytool --wait，实测约 3-5 分钟，请勿中断进程）…')
  const submit = exec('xcrun', [
    'notarytool',
    'submit',
    dmgPath,
    '--key',
    env.APPLE_API_KEY,
    '--key-id',
    env.APPLE_API_KEY_ID,
    '--issuer',
    env.APPLE_API_ISSUER,
    '--wait',
  ])
  const submitOutput = combinedOutput(submit)
  const { submissionId, status } = parseNotarytoolSubmitOutput(submitOutput)
  if (submit.status !== 0 || status !== 'Accepted') {
    throw new Error(
      [
        `公证未通过：status=${status ?? '未知'}（notarytool 退出码 ${submit.status}）`,
        submissionId
          ? `查详情：xcrun notarytool log ${submissionId} --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER"`
          : '未能从输出中解析出 submission id，请直接查看下方原始输出定位。',
        submitOutput ? `原始输出：\n${submitOutput}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  log(`✓ [2/3] 公证通过（submission ${submissionId}，status=Accepted）`)

  log('→ [3/3] 装订公证票据…')
  const staple = exec('xcrun', ['stapler', 'staple', dmgPath])
  if (staple.status !== 0) {
    throw new Error(
      [
        `票据装订失败：xcrun stapler staple "${dmgPath}"（退出码 ${staple.status}）`,
        '公证可能已通过但装订这一步没完成。重跑本脚本能修，但代价不是免费的——',
        '本脚本没有"只补装订"这一步，重跑会从头做一遍：codesign --force 重签 dmg → notarytool 重新提交公证',
        '（实测约 3-5 分钟，且再消耗一次 Apple 公证配额）→ 才轮到 stapler 重新装订。若只是装订这一步偶发失败，',
        `也可以只手动补跑：xcrun stapler staple "${dmgPath}"（这条命令本身是幂等的，不会重复消耗公证配额）。`,
        combinedOutput(staple) ? `原始输出：\n${combinedOutput(staple)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  log('✓ [3/3] 票据已装订')

  return { dmgPath, skipped: false, submissionId, status }
}

function parseCliArgs(argv) {
  let dmgPath
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--dmg') {
      dmgPath = argv[i + 1]
      i += 1
    }
  }
  return { dmgPath }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const { dmgPath } = parseCliArgs(process.argv.slice(2))
    // loadEnvFiles() 只在 CLI 入口调用，不在 notarizeDmg() 内部调用：
    // notarizeDmg() 接受 env 参数（默认为 process.env）供单测注入 stub 凭证——如果函数体内部
    // 再无条件读一遍仓库根的 .env.local/.env，会把测试传入的 env 悄悄换成本机真实凭证。
    // 目前这没暴露是因为本 main-module 分支只在 `node scripts/notarize-dmg.mjs` 被直接执行时触发
    // （上面 import.meta.url 判断），`bun test` 从不满足这个判断，不会走到这里——不是因为
    // loadEnvFiles 会吞掉什么异常：loadEnvFiles 现在只吞 ENOENT，其余错误（含 Bun 环境下
    // process.loadEnvFile 是 undefined 触发的 TypeError）照常向上抛，不会被静默掩盖。
    loadEnvFiles()
    notarizeDmg({ dmgPath })
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  }
}
