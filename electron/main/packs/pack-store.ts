// CapabilityPackStore：能力包库存储（list / import / uninstall / export，B2 刀1，ADR-0034 v1.1）。
//
// 双轨版本制：官方内置包随引擎走（builtinPacksDir，只读，不可卸载/导出）；用户导入包锁版本，
// 同 id 允许多版本并存于 userPacksDir/<id>@<version>/（多版本共存是设计，不是冲突）。
//
// 与 user-skill-store.ts 同构：store 不自解析 agentCorePath / userDataPath，由调用方（IPC 层）注入。
// fail-loud 校验序（见 pack-manifest.ts + 本文件 validatePackDirForInstall 注释）：manifest 可解析 →
// 必填字段（含署名非空）→ 格式号 → id/version 安全令牌（拒路径穿越，见 isSafePackToken）→
// id 非 official- 前缀 → 官方内置 id 冲突 → 同 id 同版本已装冲突
// （同 id 新版本放行并存）→ 卡 id 跨包冲突（排除同包其他版本）→ 卡文件存在且为包内相对路径。

import { cp, mkdir, mkdtemp, open, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, rmSync } from 'node:fs'
import { isAbsolute, join, normalize } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID, createHash } from 'node:crypto'
import AdmZip from 'adm-zip'
import { validatePackManifest, type PackManifest } from './pack-manifest'
import { isSafePackToken } from './pack-token'
import {
  PACK_LOCAL_SOURCE_MARKER_FILENAME,
  readPackLocalSourceMarker,
  readPackProvenance,
  removePackProvenance,
  type PackProvenanceRecord,
} from './pack-provenance'
import { lintSeverity } from './pack-lint-severity'
import { lintCardBody, type CardLintFinding } from '@shared/lib/capability-pack-lint'
import { EVIDENCE_SECTION_RE, stripEvidenceSections } from '@shared/lib/pack-card-sections'
import { NARRACAT_DIR } from '../novel/novel-layout.ts'
import {
  OFFICIAL_PACK_ID_PREFIX,
  PACK_FILE_EXTENSION,
  PACK_README_FILENAME,
  PACK_README_MAX_BYTES,
  STRUCTURE_STAGES,
  compareSemver,
  type CapabilityPackSummary,
  type ImportPackResult,
  type ExportPackResult,
  type PackDetailResult,
  type PackLicense,
  type PackRightsMetadata,
  type PlanningCapabilityReceiptData,
  type PreviewImportPackResult,
} from '@shared/types/capability-pack'

export function userPacksDir(userDataPath: string): string {
  return join(userDataPath, 'packs')
}
export function builtinPacksDir(agentCorePath: string): string {
  return join(agentCorePath, 'packs')
}
/** 用户包版本化布局约定：`<id>@<version>`，与引擎 resolver 对齐。 */
export function packVersionDirName(id: string, version: string): string {
  return `${id}@${version}`
}

/** zip 条目/卡路径穿越校验：拒绝绝对路径与含 `..` 分段的相对路径。跨 store 复用（见 pack-drafts.ts）。 */
export function isSafeRelative(p: string): boolean {
  return !isAbsolute(p) && !normalize(p).split(/[\\/]/).includes('..')
}

/** id/version 安全令牌校验：定义处见 pack-token.ts（独立模块避免与 pack-manifest.ts 循环依赖）；
 * 从此处 re-export 保持既有调用点（pack-local-content.ts / pack-publish.ts 等）零改动。 */
export { isSafePackToken } from './pack-token'

async function readPackDir(dir: string, origin: 'official' | 'user'): Promise<CapabilityPackSummary | null> {
  try {
    const raw = JSON.parse(await readFile(join(dir, 'pack.json'), 'utf8'))
    const { manifest } = validatePackManifest(raw)
    if (!manifest) return null
    const counts = { persona: 0, craft: 0, structure: 0, benchmark: 0 }
    for (const card of manifest.cards) counts[card.type as keyof typeof counts] += 1
    return {
      id: manifest.id, name: manifest.name, author: manifest.author, version: manifest.version,
      ...(manifest.description ? { description: manifest.description } : {}),
      ...(manifest.min_engine_version ? { minEngineVersion: manifest.min_engine_version } : {}),
      origin, cardCount: manifest.cards.length, cardTypeCounts: counts,
    }
  } catch {
    return null
  }
}

export async function listCapabilityPacks(input: { agentCorePath: string; userDataPath: string }): Promise<CapabilityPackSummary[]> {
  const result: CapabilityPackSummary[] = []
  for (const [dir, origin] of [[builtinPacksDir(input.agentCorePath), 'official'], [userPacksDir(input.userDataPath), 'user']] as const) {
    if (!existsSync(dir)) continue
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const summary = await readPackDir(join(dir, entry.name), origin)
      if (summary) result.push(summary)
    }
  }
  return result
}

/**
 * 收集已安装包（内置 + 用户）的全部卡 id，供导入时做跨包卡 id 冲突检测。
 * 跳过 manifest.id === excludePackId 的包——同一能力包的其他版本天然共享卡 id，不算冲突
 * （多版本并存是双轨制轨道二的设计，不是冲突信号）。
 */
async function collectInstalledCardIds(
  input: { agentCorePath: string; userDataPath: string },
  excludePackId: string,
): Promise<Set<string>> {
  const ids = new Set<string>()
  for (const dir of [builtinPacksDir(input.agentCorePath), userPacksDir(input.userDataPath)]) {
    if (!existsSync(dir)) continue
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      try {
        const raw = JSON.parse(await readFile(join(dir, entry.name, 'pack.json'), 'utf8'))
        const { manifest } = validatePackManifest(raw)
        if (!manifest || manifest.id === excludePackId) continue
        for (const card of manifest.cards) ids.add(card.id)
      } catch {
        // 损坏/不可读的邻居包不阻断本次导入判定，跳过
      }
    }
  }
  return ids
}

async function findEvidenceViolations(packDir: string, manifest: PackManifest): Promise<string[]> {
  const violations: string[] = []
  for (const card of manifest.cards) {
    if (!isSafeRelative(card.path)) continue
    const body = await readFile(join(packDir, card.path), 'utf8').catch(() => '')
    for (const m of body.matchAll(EVIDENCE_SECTION_RE)) {
      if (m[1].trim().length > 0) {
        violations.push(card.id)
        break
      }
    }
  }
  return violations
}

/**
 * 递归扫描包目录，任何符号链接一律拒绝（含目录型链接）。
 * 目录导入会经 fs.cp 原样保留 symlink，安装后引擎按相对路径读卡会跟随链接读到包外文件
 * （外部文件还可在 preview 与 confirm 之间被替换）——直接在校验期拒绝是唯一完备防线；
 * zip 通道不受影响（AdmZip 解包不还原 symlink）。跨 store 复用（见 pack-drafts.ts）。
 */
export async function findSymlink(dir: string): Promise<string | null> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isSymbolicLink()) return full
    if (entry.isDirectory()) {
      const nested = await findSymlink(full)
      if (nested) return nested
    }
  }
  return null
}

/** 校验一个已就位的包目录能否安装（导入校验序全量，见文件头注释）。返回 manifest 或错误。 */
async function validatePackDirForInstall(
  sourceDir: string,
  input: { agentCorePath: string; userDataPath: string },
): Promise<{ manifest: PackManifest } | { error: { status: 'invalid' | 'conflict'; message: string } }> {
  const symlink = await findSymlink(sourceDir)
  if (symlink) return { error: { status: 'invalid', message: '包内含符号链接，已拒绝导入（安全限制）。' } }
  const raw = JSON.parse(await readFile(join(sourceDir, 'pack.json'), 'utf8'))
  const { manifest, errors } = validatePackManifest(raw)
  if (!manifest) return { error: { status: 'invalid', message: `包格式不合法：${errors.join('；')}` } }
  if (!isSafePackToken(manifest.id) || !isSafePackToken(manifest.version)) {
    return { error: { status: 'invalid', message: '包 id 或 version 含非法字符（仅允许字母数字与 `._-`，且不可含路径分隔符）。' } }
  }
  if (manifest.id.startsWith(OFFICIAL_PACK_ID_PREFIX)) return { error: { status: 'invalid', message: '包 id 使用了官方保留前缀。' } }
  const installed = await listCapabilityPacks(input)
  if (installed.some((p) => p.origin === 'official' && p.id === manifest.id)) return { error: { status: 'conflict', message: `与官方内置包同 id「${manifest.id}」。` } }
  if (installed.some((p) => p.id === manifest.id && p.version === manifest.version)) return { error: { status: 'conflict', message: `「${manifest.id}@${manifest.version}」已安装。` } }
  // 同 id 新版本 → 放行并存（双轨制轨道二）
  const installedCardIds = await collectInstalledCardIds(input, manifest.id) // 收集时排除 manifest.id 自己的其他版本
  for (const card of manifest.cards) {
    if (!isSafeRelative(card.path)) return { error: { status: 'invalid', message: `卡「${card.id}」路径不是包内相对路径。` } }
    if (!existsSync(join(sourceDir, card.path))) return { error: { status: 'invalid', message: `卡文件缺失：${card.path}` } }
    if (installedCardIds.has(card.id)) return { error: { status: 'conflict', message: `卡 id「${card.id}」与已装包冲突。` } }
  }
  return { manifest }
}

interface PendingImport {
  stagingDir: string
}
const pendingImports = new Map<string, PendingImport>()

async function disposePendingImport(token: string): Promise<void> {
  const pending = pendingImports.get(token)
  if (!pending) return
  pendingImports.delete(token)
  await rm(pending.stagingDir, { recursive: true, force: true })
}

export async function disposeAllPendingCapabilityPackImports(): Promise<void> {
  for (const token of [...pendingImports.keys()]) await disposePendingImport(token)
}

/** 退出路径专用同步清理：will-quit 不等待异步操作，必须同步删干净 staging（尽力而为，不抛）。 */
export function disposeAllPendingCapabilityPackImportsSync(): void {
  for (const [token, pending] of [...pendingImports]) {
    pendingImports.delete(token)
    try {
      rmSync(pending.stagingDir, { recursive: true, force: true })
    } catch {
      // 退出路径尽力而为：残留交给系统 tmp 清理
    }
  }
}

export async function cancelCapabilityPackImport(input: { token: string }): Promise<void> {
  await disposePendingImport(input.token)
}

/**
 * 逐卡扫描 staging 内 `cards/*.md`（`lintCardBody`，与发布拦截同一份规则），按文件聚合成
 * lintWarnings：只警示不阻断（status 仍 ok），severity 取该文件命中 rule 的最高级（block > warn），
 * 供 UI 分级展示（B2 刀3 Task 9，与发布场景共用 pack-lint-severity.ts 的判据表）。
 */
async function collectImportLintWarnings(
  stagingDir: string,
): Promise<Array<{ file: string; severity: 'block' | 'warn'; findings: CardLintFinding[] }>> {
  const cardsDir = join(stagingDir, 'cards')
  if (!existsSync(cardsDir)) return []
  const warnings: Array<{ file: string; severity: 'block' | 'warn'; findings: CardLintFinding[] }> = []
  for (const entry of await readdir(cardsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const body = await readFile(join(cardsDir, entry.name), 'utf8').catch(() => '')
    const findings = lintCardBody(body)
    if (findings.length === 0) continue
    const severity = findings.some((f) => lintSeverity(f.rule) === 'block') ? 'block' : 'warn'
    warnings.push({ file: `cards/${entry.name}`, severity, findings })
  }
  return warnings
}

/**
 * 导入第一步：把源物料（.narracatpack zip 或目录）复制/解包进临时 staging 区并跑全量校验。
 * 成功 → 登记 pending（token 握手），返回摘要（manifest + README + lintWarnings）；失败 → 清 staging 返错。
 * 单飞策略：发起新 preview 先清掉全部旧 pending（UI 同时只有一个导入流程）。
 */
export async function previewCapabilityPackImport(
  input: { sourcePath: string; agentCorePath: string; userDataPath: string },
): Promise<PreviewImportPackResult> {
  await disposeAllPendingCapabilityPackImports()
  const stagingDir = join(tmpdir(), `narracat-pack-preview-${randomUUID()}`)
  try {
    if (input.sourcePath.endsWith(PACK_FILE_EXTENSION)) {
      const zip = new AdmZip(input.sourcePath)
      for (const entry of zip.getEntries()) {
        if (!isSafeRelative(entry.entryName)) {
          return { status: 'invalid', message: '包文件包含非法路径条目。' }
        }
      }
      zip.extractAllTo(stagingDir, true)
    } else {
      await cp(input.sourcePath, stagingDir, { recursive: true })
    }
    const validated = await validatePackDirForInstall(stagingDir, input)
    if ('error' in validated) return validated.error
    const token = randomUUID()
    pendingImports.set(token, { stagingDir })
    return {
      status: 'ok',
      token,
      manifest: validated.manifest,
      ...(await readPackReadme(stagingDir)),
      lintWarnings: await collectImportLintWarnings(stagingDir),
    }
  } catch (error) {
    return { status: 'invalid', message: `包读取失败：${error instanceof Error ? error.message : String(error)}` }
  } finally {
    // 只有登记成功的 staging 保留到 confirm/cancel；其余路径（校验失败/异常）就地清
    if (![...pendingImports.values()].some((p) => p.stagingDir === stagingDir)) {
      await rm(stagingDir, { recursive: true, force: true })
    }
  }
}

/**
 * 导入第二步：从已校验的 staging 区落库安装（绝不回读用户原文件，TOCTOU 防护）。
 * confirm 前重跑安装校验——preview 与 confirm 之间库存可能已变（并发装入同版本等）。
 */
export async function confirmCapabilityPackImport(
  input: { token: string; agentCorePath: string; userDataPath: string },
): Promise<ImportPackResult> {
  // 原子消费：任何 await 之前同步摘除 token——并发 confirm 同一 token 只有一个能拿到 staging
  const pending = pendingImports.get(input.token)
  if (!pending) return { status: 'invalid', message: '导入会话已失效，请重新选择包文件。' }
  pendingImports.delete(input.token)
  try {
    const validated = await validatePackDirForInstall(pending.stagingDir, input)
    if ('error' in validated) return validated.error
    const { manifest } = validated
    const target = join(userPacksDir(input.userDataPath), packVersionDirName(manifest.id, manifest.version))
    await mkdir(userPacksDir(input.userDataPath), { recursive: true })
    await cp(pending.stagingDir, target, { recursive: true })
    return { status: 'ok', packs: await listCapabilityPacks(input) }
  } catch (error) {
    return { status: 'invalid', message: `包安装失败：${error instanceof Error ? error.message : String(error)}` }
  } finally {
    await rm(pending.stagingDir, { recursive: true, force: true })
  }
}

export async function uninstallCapabilityPack(input: { id: string; version: string; userDataPath: string }): Promise<CapabilityPackSummary[]> {
  const base = userPacksDir(input.userDataPath)
  // 纵深守卫：即便调用方（IPC 层）拿到一个绕过了导入校验的 id/version（例如已装包的元数据被篡改），
  // 也不能让拼接出的目录名逃出 userPacksDir——不安全时跳过删除，只回落到读列表。
  if (isSafeRelative(packVersionDirName(input.id, input.version))) {
    const dir = join(base, packVersionDirName(input.id, input.version))
    if (existsSync(dir)) await rm(dir, { recursive: true, force: true })
  }
  // 卸载后清掉该版本的本机来源记录（造包中心 B2 刀3 Task 10）：provenance key 只是 JSON 对象键，
  // 不拼磁盘路径，无需过 isSafeRelative 守卫；key 不存在时 removePackProvenance 静默跳过。
  // provenance.json 本身损坏时 removePackProvenance 会 fail-closed 抛错（PR#477 P1-4）——目录已经
  // 删了，用户明确要卸载这个包，不该因为一份读不出来的记录文件挡住卸载，这里吞掉异常继续；
  // 记录清不掉只是留一条陈旧/不可读的 provenance，不放宽任何导出判断（导出侧各自 fail-closed）。
  try {
    await removePackProvenance(input.userDataPath, `${input.id}@${input.version}`)
  } catch {
    // 见上方注释：provenance 损坏不阻断卸载
  }
  const result: CapabilityPackSummary[] = []
  if (existsSync(base)) {
    for (const entry of await readdir(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const summary = await readPackDir(join(base, entry.name), 'user')
      if (summary) result.push(summary)
    }
  }
  return result
}

/** 递归、键序确定的 JSON 序列化：同一份数据不管原始键序如何，恒产出同一字符串（供内容哈希用）。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record).sort()
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(record[k])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * 内容哈希：对 pack.json（剔除 `content_hash` 字段后按键序规范化）+ `cards/*.md`（按文件名排序）+
 * README.md 依序拼接算 sha256。纯函数，只读取传入目录当下的内容，不关心它是库内原件还是导出副本——
 * 导出流程在「改完副本、写回 content_hash 前」调用它，取得的是本次导出最终会落盘的哈希（幂等：同一份
 * 内容多次导出得同一哈希）。导入侧不校验，只透传展示（校验留给 B5）。
 */
export async function computePackContentHash(dir: string): Promise<string> {
  const raw = JSON.parse(await readFile(join(dir, 'pack.json'), 'utf8')) as Record<string, unknown>
  delete raw.content_hash
  const parts = [stableStringify(raw)]
  const cardsDir = join(dir, 'cards')
  if (existsSync(cardsDir)) {
    const cardFiles = (await readdir(cardsDir)).filter((f) => f.endsWith('.md')).sort()
    for (const file of cardFiles) parts.push(await readFile(join(cardsDir, file), 'utf8'))
  }
  parts.push(await readFile(join(dir, PACK_README_FILENAME), 'utf8').catch(() => ''))
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part)
  return `sha256:${hash.digest('hex')}`
}

/**
 * 导出（B2 刀3 合规出口，Task 9；PR#477 外审 P1-4 补 fail-closed + 纵深标记）：
 * ⓪纵深标记门——包版本目录内的 `.narracat-local-source.json` 若标着 `learned-external`，在
 *   provenance 门之前先拒（即便 pack-provenance.json 被整份删除/损坏也挡得住，标记只用于收紧
 *   判断，缺失/损坏不影响后续正常流程）；
 * ①provenance 门——读不出 provenance（fail-closed：IO 错误/JSON 损坏/非对象结构）一律 invalid，
 *   绝不当空记录放行（外审实证：此前 fail-soft 会让 learned-external 包在 provenance 损坏后被
 *   误判成「imported」原样转发导出）；读得出但 `learned-external` → forbidden，仅限本机使用；
 * ②`rightsConfirmed !== true` → invalid（不分来源，导出前都须确认拥有分享权利）；
 * ③evidence 摘录区红线按来源分流（刀4 Task 10，spec §5）——
 *   ④查无 provenance 记录（imported，非本机造包中心产出）→ 摘录区非空硬拒（不改别人包的内容），
 *   否则原样转发（zip 过滤掉纵深标记文件本身，防止标记泄漏进导出物）：不改库内原件也不改导出
 *   副本的 readme/权利元数据，维持刀1/刀2 既有行为；
 *   ⑤有 provenance 记录（created/learned-own）→ 复制到 tmp 副本改（先删掉纵深标记文件，本机
 *   标记不该出现在分享出去的导出物里），逐卡 stripEvidenceSections 自动清空摘录内容（保留
 *   `[evidence]` 标记本身）后复验，仍非空则中止导出（防御深度）；再注入 readme 覆盖（如传入）+
 *   license + derived_from（取自 provenance）+ content_hash（覆盖清空后的内容），最后 zip；
 *   库内原件全程零改动。
 */
export async function exportCapabilityPack(input: {
  id: string
  version: string
  userDataPath: string
  targetPath: string
  license: PackLicense
  rightsConfirmed: boolean
  readme?: string
}): Promise<ExportPackResult> {
  // 纵深守卫：同 uninstallCapabilityPack，拼接前先确认目录名没有逃出 userPacksDir。
  if (!isSafeRelative(packVersionDirName(input.id, input.version))) {
    return { status: 'not-found', message: '未找到该用户包（官方内置包不支持导出）。' }
  }
  const dir = join(userPacksDir(input.userDataPath), packVersionDirName(input.id, input.version))
  if (!existsSync(dir)) return { status: 'not-found', message: '未找到该用户包（官方内置包不支持导出）。' }
  const raw = JSON.parse(await readFile(join(dir, 'pack.json'), 'utf8')) as Record<string, unknown>
  // validatePackManifest 只当校验闸门用（errors 非空才拒；warnings 不阻断）——不能把它规范化后的返回值
  // 当导出内容的注入基底，见下方「created / learned-own」分支注释。
  const { manifest, errors } = validatePackManifest(raw)
  if (!manifest) return { status: 'invalid', message: `包 manifest 已损坏：${errors.join('；')}` }

  // ⓪纵深标记门（PR#477 P1-4）：在 provenance 门之前先查，标记只用于收紧不用于放宽，无需防伪。
  const marker = await readPackLocalSourceMarker(dir)
  if (marker === 'learned-external') {
    return { status: 'forbidden', message: '从外部书学习的包仅限本机使用，不能导出分享' }
  }

  let provenance: PackProvenanceRecord
  try {
    provenance = await readPackProvenance(input.userDataPath)
  } catch {
    return { status: 'invalid', message: '本机包来源记录无法读取，已拒绝导出。请重启应用后重试。' }
  }
  const entry = provenance[`${input.id}@${input.version}`]
  if (entry?.source === 'learned-external') {
    return { status: 'forbidden', message: '从外部书学习的包仅限本机使用，不能导出分享' }
  }
  if (input.rightsConfirmed !== true) {
    return { status: 'invalid', message: '导出前须确认拥有本包内容的分享权利。' }
  }

  // imported：查无 provenance 记录 → 摘录区非空硬拒（我们不改别人包的内容），否则原样转发，
  // 不注入权利元数据、不覆盖 readme（既有行为）；zip 过滤掉纵深标记文件，防止本机标记泄漏进导出物。
  if (!entry) {
    const violations = await findEvidenceViolations(dir, manifest)
    if (violations.length > 0) return { status: 'invalid', message: `卡「${violations.join('、')}」摘录区非空，按社区标准不可导出（版权红线）。` }
    const zip = new AdmZip()
    zip.addLocalFolder(dir, '', (entryPath) => !entryPath.endsWith(PACK_LOCAL_SOURCE_MARKER_FILENAME))
    zip.writeZip(input.targetPath)
    return { status: 'ok', filePath: input.targetPath }
  }

  // created / learned-own：复制到 tmp 副本改，库内原件零改动。
  const tmpRoot = await mkdtemp(join(tmpdir(), 'narracat-pack-export-'))
  try {
    const copyDir = join(tmpRoot, 'pack')
    await cp(dir, copyDir, { recursive: true })
    // 纵深标记不该出现在分享出去的导出物里：created 通常本就没有这份标记（no-op），
    // learned-own 有（发布时写入，见 pack-publish.ts），导出前删掉。
    await rm(join(copyDir, PACK_LOCAL_SOURCE_MARKER_FILENAME), { force: true })

    // 摘录区自动清空（刀4 Task 10，spec §5）：造包中心产出的包不强制用户手动删摘录，导出前逐卡清空
    // [evidence] 段内容（保留标记本身，供下游 UI 提示"证据留在本机原件"）；清空后复验，非空即中止
    // 导出——防御深度，兜底 stripEvidenceSections 或卡路径解析漏网的情况。
    for (const card of manifest.cards) {
      if (!isSafeRelative(card.path)) continue
      const cardPath = join(copyDir, card.path)
      const body = await readFile(cardPath, 'utf8').catch(() => null)
      if (body === null) continue
      await writeFile(cardPath, stripEvidenceSections(body), 'utf8')
    }
    const remaining = await findEvidenceViolations(copyDir, manifest)
    // 此分支静态推演不可达（stripEvidenceSections 完全替换后复验必空），纯防御纵深兜底，防未来清空与复验逻辑分叉
    if (remaining.length > 0) return { status: 'invalid', message: '摘录区清空失败，已中止导出。' }

    if (input.readme !== undefined) {
      await writeFile(join(copyDir, PACK_README_FILENAME), input.readme, 'utf8')
    }
    // 注入基底用 raw（磁盘原文件），不用 manifest（validatePackManifest 规范化后的产物）——manifest
    // 按已知字段白名单回填、会静默丢弃未知卡 type / 未知顶层字段，若 App 侧 schema 落后于引擎
    // （人工同步漂移），用 manifest 做基底会让导出物静默丢卡/丢字段（卡文件还在 zip 里但 manifest
    // 不再引用它，content_hash 还会把这份被裁剪过的内容当"正确"内容去算）。见评审 Needs fixes 回归用例。
    const injected: Record<string, unknown> = { ...raw, license: input.license }
    delete injected.content_hash
    if (entry.derivedFrom) injected.derived_from = entry.derivedFrom
    else delete injected.derived_from
    await writeFile(join(copyDir, 'pack.json'), JSON.stringify(injected, null, 2), 'utf8')
    const contentHash = await computePackContentHash(copyDir)
    await writeFile(join(copyDir, 'pack.json'), JSON.stringify({ ...injected, content_hash: contentHash }, null, 2), 'utf8')

    const zip = new AdmZip()
    zip.addLocalFolder(copyDir)
    zip.writeZip(input.targetPath)
    return { status: 'ok', filePath: input.targetPath }
  } finally {
    await rm(tmpRoot, { recursive: true, force: true })
  }
}

async function readPackReadme(dir: string): Promise<{ readme?: string; readmeTruncated?: boolean }> {
  try {
    const handle = await open(join(dir, PACK_README_FILENAME), 'r')
    try {
      const { size } = await handle.stat()
      if (size > PACK_README_MAX_BYTES) {
        // 有界读取：只读上限字节数，绝不整读超大文件进内存
        const buf = Buffer.alloc(PACK_README_MAX_BYTES)
        const { bytesRead } = await handle.read(buf, 0, PACK_README_MAX_BYTES, 0)
        let end = bytesRead
        // 从末尾回看：若最后一个字符的多字节序列被切断（首字节+后续续字节数不足），把整个残缺序列裁掉
        let back = end - 1
        while (back >= 0 && (buf[back] & 0xc0) === 0x80) back--
        if (back >= 0 && buf[back] >= 0xc0) {
          const lead = buf[back]
          const expected = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : 2
          if (end - back < expected) end = back
        }
        return { readme: buf.subarray(0, end).toString('utf8'), readmeTruncated: true }
      }
      const text = (await handle.readFile()).toString('utf8')
      return text.trim().length > 0 ? { readme: text } : {}
    } finally {
      await handle.close()
    }
  } catch {
    return {}
  }
}

/** manifest 权利元数据透出：content_hash/license/derived_from 均可选，原样透传（缺省字段随之缺省）。 */
function rightsFromManifest(manifest: PackManifest): PackRightsMetadata {
  return {
    ...(manifest.content_hash ? { content_hash: manifest.content_hash } : {}),
    ...(manifest.license ? { license: manifest.license } : {}),
    ...(manifest.derived_from ? { derived_from: manifest.derived_from } : {}),
  }
}

/** 详情页取数：manifest 全量 + 包根 README + 该 id 已装版本列表（SemVer 降序）+ 本机来源标记 + 权利元数据。
 * 绝不读卡正文。localSource 查 provenance（`<id>@<version>` key，官方包/纯导入包一律查无 → 字段缺省）。 */
export async function getCapabilityPackDetail(
  input: { id: string; version?: string; agentCorePath: string; userDataPath: string },
): Promise<PackDetailResult> {
  const notFound: PackDetailResult = { status: 'not-found', message: '未找到该能力包或指定版本。' }
  // 官方内置：目录名即包名（非版本化布局），按 manifest.id 匹配
  const builtin = builtinPacksDir(input.agentCorePath)
  if (existsSync(builtin)) {
    for (const entry of await readdir(builtin, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(builtin, entry.name)
      try {
        const { manifest } = validatePackManifest(JSON.parse(await readFile(join(dir, 'pack.json'), 'utf8')))
        if (!manifest || manifest.id !== input.id) continue
        if (input.version && input.version !== manifest.version) return notFound
        // 展示层 fail-soft（PR#477 P1-4）：provenance 损坏只影响这里的 localSource 徽标展示，
        // 不是导出/复制那类安全决策点——读不出来就不展示徽标，不该连详情页本身都打不开。
        const localSource = await readPackProvenance(input.userDataPath)
          .then((p) => p[`${manifest.id}@${manifest.version}`]?.source)
          .catch(() => undefined)
        return {
          status: 'ok',
          detail: {
            manifest, origin: 'official', installedVersions: [manifest.version],
            ...(await readPackReadme(dir)),
            ...(localSource ? { localSource } : {}),
            rights: rightsFromManifest(manifest),
          },
        }
      } catch {
        continue
      }
    }
  }
  // 用户包：<id>@<version> 版本化布局，收齐全部版本再选
  const userDir = userPacksDir(input.userDataPath)
  const versions: Array<{ version: string; dir: string; manifest: PackManifest }> = []
  if (existsSync(userDir)) {
    for (const entry of await readdir(userDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const dir = join(userDir, entry.name)
      try {
        const { manifest } = validatePackManifest(JSON.parse(await readFile(join(dir, 'pack.json'), 'utf8')))
        if (manifest && manifest.id === input.id) versions.push({ version: manifest.version, dir, manifest })
      } catch {
        continue
      }
    }
  }
  if (versions.length === 0) return notFound
  versions.sort((a, b) => compareSemver(b.version, a.version))
  const picked = input.version ? versions.find((v) => v.version === input.version) : versions[0]
  if (!picked) return notFound
  // 展示层 fail-soft（PR#477 P1-4），理由同上（官方包分支）。
  const localSource = await readPackProvenance(input.userDataPath)
    .then((p) => p[`${picked.manifest.id}@${picked.version}`]?.source)
    .catch(() => undefined)
  return {
    status: 'ok',
    detail: {
      manifest: picked.manifest,
      origin: 'user',
      installedVersions: versions.map((v) => v.version),
      ...(await readPackReadme(picked.dir)),
      ...(localSource ? { localSource } : {}),
      rights: rightsFromManifest(picked.manifest),
    },
  }
}

/**
 * 规划期装载回执（B2 刀3 Task 10）：读 `<projectPath>/.narracat/capability-receipts/planning-<stage>.json`
 * 三份（引擎 `writePlanningCapabilityReceipt` 落盘产物，spec §6），有则纳入返回数组——文件缺失/损坏一律
 * 跳过该份，不阻断其余两份读取（fail-soft，同 readChapterCapabilityReceipt 惯例）。
 */
export async function getPlanningCapabilityReceipts(
  input: { projectPath: string },
): Promise<PlanningCapabilityReceiptData[]> {
  const results: PlanningCapabilityReceiptData[] = []
  for (const stage of STRUCTURE_STAGES) {
    const path = join(input.projectPath, NARRACAT_DIR, 'capability-receipts', `planning-${stage}.json`)
    try {
      const raw = JSON.parse(await readFile(path, 'utf8'))
      if (raw && typeof raw === 'object' && raw.stage && Array.isArray(raw.entries)) {
        results.push(raw as PlanningCapabilityReceiptData)
      }
    } catch {
      // 缺失/损坏：跳过该份 stage，不阻断其余两份
    }
  }
  return results
}
