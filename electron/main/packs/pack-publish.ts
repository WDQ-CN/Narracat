// PackPublish：造包中心「发布铸版」——草稿 → 不可变发布工件（B2 刀3 Task 7）。
//
// 全过才落库（brief 八步，实现顺序对齐）：
// ①读草稿 + 逐卡组装 manifest 卡条目（compiled 字段直接对齐 pack-manifest.ts 字段名；无 compiled 的卡拦截）
// ②逐卡 lintCardBody 分级（编排方修订一，分级判据见 pack-lint-severity.ts；Task 9 导入扫描复用同一份映射）
// ②b（刀4）learned-external 用源指纹重扫正文（摘录区外），堵「学完慢慢搬原文」的洗白路径
// ③version 安全前置校验（终审修复：须先于任何 packVersionDirName/existsSync 使用，见下方注释）+
//   确定包 id（含 meta.packId 安全令牌校验，见 resolvePackId）
// validatePackManifest 全量兜底
// ④`<id>@<version>` 目录冲突检测
// ⑤落盘 pack.json + cards/<cardId>.md + README.md（learned-external 落盘剥离摘录区，见 ⑤ 注释）
// ⑥recordPackProvenance（source: draft.meta.localSource ?? 'created' 三值，刀4 接入学习来源）
// ⑦draft.meta.lastPublishedVersion（+ 首发 packId）回写
// ⑧appendPackEvent('publish')

import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getPackDraft, packDraftsDir, updatePackDraft } from './pack-drafts'
import { validatePackManifest, type PackCardEntry, type PackManifest } from './pack-manifest'
import { listCapabilityPacks, packVersionDirName, userPacksDir } from './pack-store'
import { isSafePackToken } from './pack-token'
import { lintCardBody, type CardLintFinding } from '@shared/lib/capability-pack-lint'
import { PACK_FORMAT_VERSION, SEMVER_RE, type CapabilityPackSummary, type DraftCard, type StructureStage } from '@shared/types/capability-pack'
import { recordPackProvenance, appendPackEvent, writePackLocalSourceMarker } from './pack-provenance'
import { lintSeverity } from './pack-lint-severity'
import { scanTextReuse, type SourceFingerprint } from './text-reuse-scan'
import { SOURCE_FINGERPRINT_FILENAME } from './pack-learn'
import { extractNonEvidenceText, stripEvidenceSections } from '@shared/lib/pack-card-sections'

export interface PublishLintFinding extends CardLintFinding {
  severity: 'block' | 'warn'
}

export type PublishPackResult =
  | { status: 'ok'; summary: CapabilityPackSummary }
  | { status: 'invalid'; errors: string[]; lintFindings: Array<{ cardId: string; findings: PublishLintFinding[] }> }

/** 卡文件名安全字符集：只准字母数字/下划线/短横（真实 cardId 恒为 randomUUID，天然满足）。
 * cardId 直接拼进磁盘路径 `cards/<cardId>.md`，若放行 `/`、`..` 之类片段会路径穿越出 packDir——
 * 同 pack-store.ts / pack-drafts.ts 一贯的纵深守卫先例，宁可严格拒绝也不静默放行。 */
const SAFE_CARD_FILE_ID = /^[A-Za-z0-9_-]+$/

/** 草稿名 → 包 id 片段：非法字符转 `-`，连续 `-` 折叠，首尾裁掉；纯中文名等退化为空时回落固定词，
 * 避免产出仅剩前缀的边界 id（`user-`）。 */
function slugifyDraftName(name: string): string {
  const collapsed = name
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return collapsed || 'pack'
}

/**
 * 首发定 id：draft.meta.packId 已存在直接复用（固定不变）；否则 `user-` + slug(name)，与已装包
 * （含官方）冲突时追加短 uuid 后缀。
 *
 * meta.packId 短路分支必须过 `isSafePackToken` 校验才能放行——它来自 draft.json 的 meta，而
 * `updatePackDraft` 的 patch.meta 是不受限的 `Partial<PackDraftMeta>`。IPC 层已白名单拦截
 * （ipc-pack-draft-input），此防线保留是因 draft.json 可被磁盘手改——`packVersionDirName`
 * 会把它原样拼进磁盘路径，放行 `..`/`/` 之类片段会路径穿越出 userPacksDir（纵深不撤）。
 * slug 生成分支产出的 id 恒经 slugifyDraftName 净化，天然安全，不需要重复校验。
 */
async function resolvePackId(
  input: { userDataPath: string; agentCorePath: string },
  draftMeta: { name: string; packId?: string },
): Promise<{ status: 'ok'; packId: string } | { status: 'invalid'; message: string }> {
  if (draftMeta.packId) {
    if (!isSafePackToken(draftMeta.packId)) {
      return { status: 'invalid', message: '包 id 含非法字符，无法发布。' }
    }
    return { status: 'ok', packId: draftMeta.packId }
  }
  const base = `user-${slugifyDraftName(draftMeta.name)}`
  const installed = await listCapabilityPacks(input)
  if (!installed.some((p) => p.id === base)) return { status: 'ok', packId: base }
  return { status: 'ok', packId: `${base}-${randomUUID().slice(0, 8)}` }
}

/** 组装单卡 manifest 条目：compiled.fields 直接对齐 pack-manifest.ts 字段名（Task 6 编译产物）。
 * 调用前调用方已确保 card.compiled 非空（见 publishPackDraft 未编译卡拦截）。 */
function buildCardEntry(card: DraftCard): PackCardEntry {
  const path = `cards/${card.cardId}.md`
  const fields = card.compiled!.fields
  if (card.type === 'structure') {
    return {
      type: 'structure', id: card.cardId, path,
      dimension: fields.dimension as string,
      stage: fields.stage as StructureStage,
      one_line: card.oneLine,
    }
  }
  if (card.type === 'persona') {
    return { type: 'persona', id: card.cardId, path, name: card.name, keywords: fields.keywords as string[] }
  }
  return {
    type: 'craft', id: card.cardId, path,
    triggers: fields.triggers as string[],
    beat_types: fields.beat_types as string[],
    technique_tags: fields.technique_tags as string[],
    emotion_tags: fields.emotion_tags as string[],
    exclusions: fields.exclusions as string[],
    priority: fields.priority as number,
  }
}

export async function publishPackDraft(input: {
  userDataPath: string
  agentCorePath: string
  draftId: string
  version: string
  /** warn 级 lint 命中后作者显式确认放行；默认 false（fail-safe：不确认一律拦）。 */
  acknowledgeWarnings?: boolean
}): Promise<PublishPackResult> {
  const draft = await getPackDraft({ userDataPath: input.userDataPath, draftId: input.draftId })
  if (!draft) return { status: 'invalid', errors: ['草稿不存在。'], lintFindings: [] }

  // ①逐卡组装 manifest 条目：未编译卡 / 卡文件名非法字符直接拦截，不进入 lint。
  const cardEntries: PackCardEntry[] = []
  for (const card of draft.cards) {
    if (!card.compiled) {
      return { status: 'invalid', errors: [`卡「${card.name || card.cardId}」还没让系统理解，请先在这张卡上完成『让系统理解』。`], lintFindings: [] }
    }
    if (!SAFE_CARD_FILE_ID.test(card.cardId)) {
      return { status: 'invalid', errors: [`卡「${card.cardId}」标识包含非法字符，无法发布。`], lintFindings: [] }
    }
    cardEntries.push(buildCardEntry(card))
  }

  // ②逐卡 lint 分级
  const lintFindings: Array<{ cardId: string; findings: PublishLintFinding[] }> = []
  let hasBlock = false
  let hasWarn = false
  for (const card of draft.cards) {
    const raw = lintCardBody(card.body)
    if (raw.length === 0) continue
    const findings = raw.map((f) => ({ ...f, severity: lintSeverity(f.rule) }))
    lintFindings.push({ cardId: card.cardId, findings })
    if (findings.some((f) => f.severity === 'block')) hasBlock = true
    if (findings.some((f) => f.severity === 'warn')) hasWarn = true
  }
  if (hasBlock) {
    return { status: 'invalid', errors: ['卡正文命中红线规则，已拒绝发布。'], lintFindings }
  }
  if (hasWarn && !input.acknowledgeWarnings) {
    return { status: 'invalid', errors: ['卡正文命中风险提示规则，确认后可发布。'], lintFindings }
  }

  // ②b（刀4）：learned-external 工程发布前用源指纹重扫正文（摘录区外），堵「学完慢慢搬原文」的洗白路径。
  const localSource = draft.meta.localSource ?? 'created'
  if (localSource === 'learned-external') {
    let fingerprint: SourceFingerprint
    try {
      fingerprint = JSON.parse(
        await readFile(join(packDraftsDir(input.userDataPath), input.draftId, SOURCE_FINGERPRINT_FILENAME), 'utf8'),
      ) as SourceFingerprint
    } catch {
      return { status: 'invalid', errors: ['学习记录缺失，无法发布这个从外部书学来的包。'], lintFindings }
    }
    // v1 指纹没有 windowBloom（PR#477 外审 P1-2 修复前的旧格式），发布重扫会失去窗口层覆盖、
    // 放过非整句 ≥10 字原文片段——产品尚未发布无存量用户负担，直接拒绝重学即可（fail-closed）。
    if (fingerprint.version !== 2) {
      return { status: 'invalid', errors: ['学习记录版本过旧，请重新学习后再发布。'], lintFindings }
    }
    const reuseErrors: string[] = []
    for (const card of draft.cards) {
      const hits = scanTextReuse(extractNonEvidenceText(card.body), { fingerprint })
      if (hits.length > 0) {
        reuseErrors.push(`卡「${card.name}」正文与源书原文过近（命中：${hits[0].sample}），请改写后再发布。`)
      }
    }
    if (reuseErrors.length > 0) return { status: 'invalid', errors: reuseErrors, lintFindings }
  }

  // ③版本号安全前置校验：必须先于任何 packVersionDirName/existsSync 使用（终审实弹：未校验的
  // version 直接拼路径同样能路径穿越出 userPacksDir，顺序修正——SemVer 校验前置，SEMVER_RE 本身
  // 只放行数字/字母/`.`/`-`，天然拒绝 `..`/`/` 之类穿越片段）。
  if (!SEMVER_RE.test(input.version)) {
    return { status: 'invalid', errors: ['版本号不是合法版本格式（如 1.0.0），无法发布。'], lintFindings }
  }

  // ④确定包 id（含 meta.packId 短路分支的安全令牌校验，见 resolvePackId 注释）+ 版本目录冲突检测
  const packIdResult = await resolvePackId(input, draft.meta)
  if (packIdResult.status === 'invalid') {
    return { status: 'invalid', errors: [packIdResult.message], lintFindings }
  }
  const packId = packIdResult.packId
  const versionDirName = packVersionDirName(packId, input.version)
  const packDir = join(userPacksDir(input.userDataPath), versionDirName)
  if (existsSync(packDir)) {
    return { status: 'invalid', errors: [`「${packId}@${input.version}」版本已存在，请递增版本号。`], lintFindings }
  }

  const manifestInput: PackManifest = {
    pack_format_version: PACK_FORMAT_VERSION,
    id: packId,
    name: draft.meta.name,
    author: draft.meta.author,
    version: input.version,
    ...(draft.meta.description.trim() ? { description: draft.meta.description } : {}),
    cards: cardEntries,
  }
  const { manifest, errors } = validatePackManifest(manifestInput)
  if (!manifest) {
    return { status: 'invalid', errors, lintFindings }
  }

  // ⑤落盘：pack.json + cards/<cardId>.md + README.md（无 README → 空占位）
  // learned-external 发布产物剥离摘录区（stripEvidenceSections 只清空 [evidence] 段内容，标记行保留）——
  // 投递给引擎/其他用户的成品卡里不带源书原文，源文本只留在本机草稿的 draft.json 里供作者自己回看。
  await mkdir(join(packDir, 'cards'), { recursive: true })
  await writeFile(join(packDir, 'pack.json'), JSON.stringify(manifest, null, 2), 'utf8')
  for (const card of draft.cards) {
    const bodyToWrite = localSource === 'learned-external' ? stripEvidenceSections(card.body) : card.body
    await writeFile(join(packDir, 'cards', `${card.cardId}.md`), bodyToWrite, 'utf8')
  }
  const readmeContent = draft.readme.trim() ? draft.readme : `# ${draft.meta.name}\n`
  await writeFile(join(packDir, 'README.md'), readmeContent, 'utf8')

  // ⑥provenance（source 三值：created / learned-own / learned-external，见文件头注释）
  await recordPackProvenance(input.userDataPath, `${packId}@${input.version}`, {
    source: localSource,
    draftId: input.draftId,
    ...(draft.meta.derivedFrom ? { derivedFrom: draft.meta.derivedFrom } : {}),
  })

  // ⑥b 纵深标记（PR#477 外审 P1-4）：learned-* 包额外在版本目录写一份本机来源标记，导出侧会在
  // provenance 门之前先查这份标记——即便 pack-provenance.json 之后被整份删除/损坏，标记仍在，
  // 导出仍会挡住 learned-external。created 不写（导出没有额外要挡的东西）。
  if (localSource === 'learned-own' || localSource === 'learned-external') {
    await writePackLocalSourceMarker(packDir, localSource)
  }

  // ⑦draft.meta 回写：lastPublishedVersion 每次更新；packId 只在首发时写入并从此固定
  await updatePackDraft({
    userDataPath: input.userDataPath,
    draftId: input.draftId,
    patch: { meta: { lastPublishedVersion: input.version, ...(draft.meta.packId ? {} : { packId }) } },
  })

  // ⑧事件日志
  await appendPackEvent(input.userDataPath, { action: 'publish', packId, version: input.version })

  const cardTypeCounts = { persona: 0, craft: 0, structure: 0, benchmark: 0 }
  for (const c of manifest.cards) cardTypeCounts[c.type as keyof typeof cardTypeCounts] += 1
  const summary: CapabilityPackSummary = {
    id: packId,
    name: manifest.name,
    author: manifest.author,
    version: manifest.version,
    ...(manifest.description ? { description: manifest.description } : {}),
    origin: 'user',
    cardCount: manifest.cards.length,
    cardTypeCounts,
  }
  return { status: 'ok', summary }
}
