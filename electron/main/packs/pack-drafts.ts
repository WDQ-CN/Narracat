// PackDraftStore：造包中心「创作工程」（草稿包）存储层（B2 刀3，spec 2026-07-19）。
//
// 与 pack-store.ts 同构：store 不自解析 userDataPath，由调用方（IPC 层）注入。
// 存储布局：userData/pack-drafts/<draftId>/draft.json（{ meta, cards }）+ README.md。
// 卡正文内联在 draft.json 的 cards[].body（草稿期单文件事务性好；发布时才拆 cards/*.md，属刀4范畴）。
//
// 安全复用：zip 条目路径穿越校验 isSafeRelative 与符号链接扫描 findSymlink 均从 pack-store.ts
// export 复用（同一套安全护栏，不重复实现）。

import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import { findSymlink, isSafeRelative } from './pack-store'
import type { DraftCard, PackDraftMeta } from '@shared/types/capability-pack'

export function packDraftsDir(userDataPath: string): string {
  return join(userDataPath, 'pack-drafts')
}
/**
 * draftId 合法格式：本 store 里所有 draftId 都只能来自 `crypto.randomUUID()`——create 直接生成，
 * import 也会用新生成的 UUID 改写 meta.draftId（见 importPackDraftProject）。没有任何合法路径会
 * 产出非 UUID 的 draftId，故用正向白名单（而非 `isSafeRelative` 那种「排除 `..`/绝对路径」的黑名单）
 * 收紧校验：黑名单会漏过退化值（`isSafeRelative('')` 与 `isSafeRelative('.')` 均为 true，
 * `draftDir()` 会因此塌缩成 pack-drafts 根目录本身，`deletePackDraft({draftId:''})` 实测把全部
 * 草稿一起删了，export 同理会把所有工程打进一个 zip）——白名单从根上排除这类退化值。
 */
const DRAFT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 纵深守卫：draftId 来自调用方（IPC 层最终来自渲染端/导入文件），直接拼进磁盘路径前必须校验。
 * 同 pack-store.ts 的 packVersionDirName 拼接前置校验先例——非法值一律 fail-loud 抛人话错误，
 * 绝不静默降级（曾实测 draftId='../sensitive-sibling' 能删/读/打包出 pack-drafts 目录之外的任意
 * 文件、draftId='' 或 '.' 能塌缩成 pack-drafts 根目录本身，见 pack-drafts.test.ts「draftId 路径穿越纵深守卫」）。
 *
 * 注意：get/update 内部经 readDraftFile（fail-soft，parse/IO 失败会被其 try/catch 吞掉），
 * 若只在 draftDir 里检查，穿越 draftId 引发的 Error 会被那层 catch 吞成静默 null——
 * 所以 get/update/import 在调用 readDraftFile 之前额外显式调用本函数，确保穿越是 fail-loud 而非静默降级。
 */
function assertSafeDraftId(draftId: string): void {
  if (!DRAFT_ID_RE.test(draftId)) throw new Error(`非法 draftId：${draftId}`)
}
function draftDir(userDataPath: string, draftId: string): string {
  assertSafeDraftId(draftId)
  return join(packDraftsDir(userDataPath), draftId)
}
function draftJsonPath(userDataPath: string, draftId: string): string {
  return join(draftDir(userDataPath, draftId), 'draft.json')
}
function readmePath(userDataPath: string, draftId: string): string {
  return join(draftDir(userDataPath, draftId), 'README.md')
}

interface DraftFile {
  meta: PackDraftMeta
  cards: DraftCard[]
}

/**
 * 单调递增的 updatedAt：`Date.toISOString()` 只有毫秒精度，同一毫秒内连续两次写入（例如测试里
 * 紧邻的 create→update）会撞出完全相同的时间戳，导致「更新后 updatedAt 应变化」的断言偶发失败、
 * 也让按 updatedAt 排序的先后关系变得不确定。若新时间戳不严格晚于 `after`，直接把 `after` 的
 * 毫秒数 +1 作为兜底——保证同一份草稿的 updatedAt 序列严格递增，不依赖真实时钟粒度。
 */
function nextTimestamp(after?: string): string {
  const now = new Date().toISOString()
  if (after && now <= after) return new Date(new Date(after).getTime() + 1).toISOString()
  return now
}

/** draft.json 结构校验：meta 必填字段齐全（类型正确）+ cards 是数组。不深查每张卡字段（草稿期允许渐进完善）。 */
function isDraftFileShapeValid(raw: unknown): raw is DraftFile {
  if (!raw || typeof raw !== 'object') return false
  const { meta, cards } = raw as { meta?: unknown; cards?: unknown }
  if (!meta || typeof meta !== 'object' || !Array.isArray(cards)) return false
  const m = meta as Partial<PackDraftMeta>
  return (
    typeof m.draftId === 'string' &&
    typeof m.name === 'string' &&
    typeof m.author === 'string' &&
    typeof m.description === 'string' &&
    (m.lastPublishedVersion === null || typeof m.lastPublishedVersion === 'string') &&
    (m.derivedFrom === null || typeof m.derivedFrom === 'string') &&
    typeof m.updatedAt === 'string'
  )
}

/** 读 draft.json 并校验结构；解析失败或结构不齐全一律 fail-soft 返回 null（调用方决定是跳过还是报错）。 */
async function readDraftFile(userDataPath: string, draftId: string): Promise<DraftFile | null> {
  try {
    const raw = JSON.parse(await readFile(draftJsonPath(userDataPath, draftId), 'utf8'))
    return isDraftFileShapeValid(raw) ? raw : null
  } catch {
    return null
  }
}

async function writeDraftFile(userDataPath: string, draftId: string, file: DraftFile): Promise<void> {
  await writeFile(draftJsonPath(userDataPath, draftId), JSON.stringify(file, null, 2), 'utf8')
}

async function readReadme(userDataPath: string, draftId: string): Promise<string> {
  try {
    return await readFile(readmePath(userDataPath, draftId), 'utf8')
  } catch {
    return ''
  }
}

export async function listPackDrafts(input: { userDataPath: string }): Promise<PackDraftMeta[]> {
  const base = packDraftsDir(input.userDataPath)
  if (!existsSync(base)) return []
  const result: PackDraftMeta[] = []
  for (const entry of await readdir(base, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    // 损坏的 draft.json 跳过并继续，不炸整个列表（fail-soft）
    const file = await readDraftFile(input.userDataPath, entry.name)
    if (file) result.push(file.meta)
  }
  result.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
  return result
}

export async function createPackDraft(input: {
  userDataPath: string
  name: string
  derivedFrom?: string
  seed?: { cards: DraftCard[]; readme?: string; author?: string; description?: string }
}): Promise<PackDraftMeta> {
  const draftId = randomUUID()
  const meta: PackDraftMeta = {
    draftId,
    name: input.name,
    author: input.seed?.author ?? '',
    description: input.seed?.description ?? '',
    lastPublishedVersion: null,
    derivedFrom: input.derivedFrom ?? null,
    updatedAt: new Date().toISOString(),
  }
  await mkdir(draftDir(input.userDataPath, draftId), { recursive: true })
  await writeDraftFile(input.userDataPath, draftId, { meta, cards: input.seed?.cards ?? [] })
  await writeFile(readmePath(input.userDataPath, draftId), input.seed?.readme ?? '', 'utf8')
  return meta
}

export async function getPackDraft(
  input: { userDataPath: string; draftId: string },
): Promise<{ meta: PackDraftMeta; cards: DraftCard[]; readme: string } | null> {
  assertSafeDraftId(input.draftId) // readDraftFile 是 fail-soft，穿越 draftId 必须在这里先 fail-loud
  const file = await readDraftFile(input.userDataPath, input.draftId)
  if (!file) return null
  return { meta: file.meta, cards: file.cards, readme: await readReadme(input.userDataPath, input.draftId) }
}

export async function updatePackDraft(input: {
  userDataPath: string
  draftId: string
  patch: { meta?: Partial<PackDraftMeta>; cards?: DraftCard[]; readme?: string }
}): Promise<void> {
  assertSafeDraftId(input.draftId) // readDraftFile 是 fail-soft，穿越 draftId 必须在这里先 fail-loud
  const file = await readDraftFile(input.userDataPath, input.draftId)
  if (!file) throw new Error(`草稿不存在：${input.draftId}`)
  const meta: PackDraftMeta = {
    ...file.meta,
    ...input.patch.meta,
    draftId: file.meta.draftId, // draftId 是目录身份，不可被 patch 改写
    updatedAt: nextTimestamp(file.meta.updatedAt),
  }
  await writeDraftFile(input.userDataPath, input.draftId, { meta, cards: input.patch.cards ?? file.cards })
  if (input.patch.readme !== undefined) {
    await writeFile(readmePath(input.userDataPath, input.draftId), input.patch.readme, 'utf8')
  }
}

export async function deletePackDraft(input: { userDataPath: string; draftId: string }): Promise<void> {
  await rm(draftDir(input.userDataPath, input.draftId), { recursive: true, force: true })
}

/**
 * 打包整个工程目录为 `.narracatproj`（zip 根即目录内容，不含 draftId 目录名一层）。
 * 导出前扫描符号链接并拒绝——工程目录理应只含我们自己写入的 draft.json/README.md，若混入符号链接
 * （篡改/异常写入），AdmZip 打包会跟随链接把包外文件内容一并打进 zip（数据泄漏），故在源头拒绝导出。
 */
export async function exportPackDraftProject(input: { userDataPath: string; draftId: string; targetPath: string }): Promise<void> {
  const dir = draftDir(input.userDataPath, input.draftId)
  if (!existsSync(dir)) throw new Error(`草稿不存在：${input.draftId}`)
  // 合规硬门（拍板3）：学自外部书的工程永久不可导出。渲染端已禁用按钮，这里补主进程侧拦截，
  // 防止绕过 UI 直接调 IPC/脚本导出——放在 symlink 扫描之前，先挡合规再挡安全。
  // fail-closed（评审修复波）：readDraftFile 是 fail-soft，draft.json 损坏/解析失败会返回 null；
  // 若用 `file?.meta.localSource === 'learned-external'` 判断，file 为 null 时表达式短路成 false、
  // 反而放行导出——读不出 localSource 不等于「确认不是 learned-external」，与 pack-store.ts manifest
  // 损坏时 fail-closed 的先例相反，必须显式判 null 就直接拒绝，不能放行。
  const file = await readDraftFile(input.userDataPath, input.draftId)
  if (!file) throw new Error('工程数据无法读取，已拒绝导出。')
  if (file.meta.localSource === 'learned-external') {
    throw new Error('这个工程学自外部书，仅限本机使用，不能导出。')
  }
  const symlink = await findSymlink(dir)
  if (symlink) throw new Error('工程目录包含符号链接，已拒绝导出（安全限制）。')
  const zip = new AdmZip()
  zip.addLocalFolder(dir)
  zip.writeZip(input.targetPath)
}

/**
 * 从 `.narracatproj` 导入为新草稿：解 zip 到新 draftId 目录，逐条目路径穿越校验（拒绝 `..`/绝对路径），
 * 解包后再扫描符号链接（防御纵深，与 pack-store 导入校验序同款，纵使 zip 通道本身不还原 symlink）。
 * 结构不合格（非法条目/损坏 draft.json/meta 字段不齐）一律清理临时目录并抛带人话 message 的错误。
 * 导入后 meta.draftId 改写为新 id——防止同一份工程被反复导入时撞 id。
 */
export async function importPackDraftProject(input: { userDataPath: string; sourcePath: string }): Promise<PackDraftMeta> {
  const zip = new AdmZip(input.sourcePath)
  for (const entry of zip.getEntries()) {
    if (!isSafeRelative(entry.entryName)) throw new Error('工程文件包含非法路径条目，已拒绝导入。')
  }
  const draftId = randomUUID()
  const target = draftDir(input.userDataPath, draftId)
  try {
    zip.extractAllTo(target, true)
    // 纵深保留：adm-zip 解包不还原符号链接（zip 通道当前实际打不到这条分支），但和 pack-store
    // 的导入校验序保持同款调用位置，防未来换 zip 库或加真实目录导入通道时这道检查悄悄缺位。
    const symlink = await findSymlink(target)
    if (symlink) throw new Error('工程文件包含符号链接，已拒绝导入（安全限制）。')
    const file = await readDraftFile(input.userDataPath, draftId)
    if (!file) throw new Error('工程文件结构不完整或已损坏，无法导入。')
    const meta: PackDraftMeta = { ...file.meta, draftId, updatedAt: new Date().toISOString() }
    await writeDraftFile(input.userDataPath, draftId, { meta, cards: file.cards })
    return meta
  } catch (error) {
    await rm(target, { recursive: true, force: true })
    throw error instanceof Error ? error : new Error(String(error))
  }
}
