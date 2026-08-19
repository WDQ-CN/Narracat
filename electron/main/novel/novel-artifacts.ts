import type { Dirent } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'

import { readStrictMarkdownDocumentReadiness } from './document-readiness'
import {
  bibleGroupDir,
  chapterContextPackCandidates,
  chapterManuscriptCandidates,
  chapterOutlineCandidates,
  chapterOutlineDataCandidates,
  chapterReviewCandidates,
  chapterDeepReviewCandidates,
  chapterStagingPath,
  charactersDir,
  masterOutlinePath,
  outlineStructurePath,
  premisePath,
  premiseCardsDataPath,
  relationshipsPath,
  volumeOutlinePath,
  worldDir,
} from './novel-layout'
import { getReferenceWorksSummary } from './reference-works'
import { readCandidateCharacters } from './candidate-characters'
import type { OpenMemoryDb } from './memory-db'
import { readStateDimensionDisplayNames } from './character-state'
import { extractNarratorVoiceSection } from '@shared/lib/narrator-voice'
import type {
  NovelArtifact,
  NovelChapterArtifacts,
  NovelWorkbenchObjectKind,
  NovelWorkbenchArtifact,
  NovelWorkbenchArtifacts,
} from '@shared/types/novel'

const reservedBibleDirectoryNames = new Set([
  'characters',
  'world',
  'references',
  'premise',
  'style-guide',
  'relationships',
])
const bibleGroupTitles = new Map([
  ['scenes', '场景设定'],
  ['rules', '规则设定'],
])
const strictWorkbenchArtifactIds = new Set(['bible-premise', 'bible-relationships'])

function usesStrictWorkbenchReadiness(id: string): boolean {
  return strictWorkbenchArtifactIds.has(id) || id.startsWith('character-') || id.startsWith('world-')
}

export interface LoadNovelChapterArtifactsInput {
  projectPath: string
  chapterNumber: number
  volumeNumber?: number
}

export interface LoadNovelWorkbenchArtifactsInput {
  projectPath: string
  objectId: string
  volumeNumber?: number
}

type WorkbenchMarkdownArtifactSource = {
  id: string
  title: string
  relativePath: string
  /** 结构化数据契约（.json）相对路径；提供时附加为 DTO data 供 App 从契约渲染（ADR-0018） */
  dataRelativePath?: string
}
type WorkbenchDirectoryObjectKind = 'character-list' | 'world-list' | 'bible-group'

type WorkbenchObjectDescriptor =
  | {
      kind: Exclude<NovelWorkbenchObjectKind, 'chapter' | WorkbenchDirectoryObjectKind>
      title: string
      artifacts: WorkbenchMarkdownArtifactSource[]
    }
  | {
      kind: WorkbenchDirectoryObjectKind
      title: string
      directoryRelativePath: string
      extensions: string[]
      idPrefix: string
      includeExtensionInId?: boolean
    }
  | { kind: 'chapter'; title: string; chapterNumber: number }

interface ArtifactDefinition {
  kind: NovelArtifact['kind']
  title: string
  relativePath: string
  fallbackRelativePaths?: string[]
  /**
   * write 编排 staging 只读预览（刀 3 §4.6）：正式候选全 miss 时探测这里，命中则以草稿
   * 内容顶替、并在 artifact 打上 isDraft 标记。仅章节正文（kind: 'manuscript'）设置。
   */
  draftRelativePath?: string
}

function titleWithoutExtension(fileName: string): string {
  const extension = extname(fileName)
  if (!extension) return fileName
  return fileName.slice(0, -extension.length)
}

function titleFromBibleDirectory(dirName: string): string {
  const fallback = dirName.replace(/[-_]+/g, ' ').trim() || dirName
  return bibleGroupTitles.get(dirName) ?? fallback
}

function titleFromFirstMarkdownHeading(content: string): string | null {
  for (const line of content.split('\n')) {
    const match = /^\s{0,3}#\s+(.+?)\s*#*\s*$/.exec(line)
    const title = match?.[1]?.trim()
    if (title) return title
  }

  return null
}

function cleanCharacterName(value: string): string | null {
  const name = value
    .trim()
    .split(/[（(，,、；;。]/)[0]
    .replace(/^["'“”‘’「『]+|["'“”‘’」』]+$/g, '')
    .trim()

  return name || null
}

function titleFromCharacterMetadata(content: string): string | null {
  for (const line of content.split('\n')) {
    const match = /^(?:[-*]\s*)?(?:\*\*)?(?:姓名|全名|名字)(?:\*\*)?\s*[:：]\s*(.+)$/.exec(line.trim())
    const name = match?.[1] ? cleanCharacterName(match[1]) : null
    if (name) return name
  }

  return null
}

function titleFromCharacterMarkdown(content: string): string | null {
  return titleFromCharacterMetadata(content) ?? titleFromFirstMarkdownHeading(content)
}

const CHARACTER_IDENTITY_COMMENT = /<!--\s*character_identity:\s*(\{[\s\S]*?\})\s*-->/

/** 角色档案完善度阶段（渐进深化）；缺该字段的旧档按 full 兼容。 */
const CHARACTER_PROFILE_STAGES = ['stub', 'sketch', 'full'] as const
type CharacterProfileStage = (typeof CHARACTER_PROFILE_STAGES)[number]

function parseProfileStage(value: unknown): CharacterProfileStage {
  return typeof value === 'string' &&
    (CHARACTER_PROFILE_STAGES as readonly string[]).includes(value)
    ? (value as CharacterProfileStage)
    : 'full'
}

/** 解析角色档案顶部的 character_identity HTML 注释（canonical 身份由 Agent Core 写入；App 只读不发明） */
function parseCharacterIdentity(
  content: string,
): { characterUid: string; name: string; profileStage: CharacterProfileStage } | null {
  const match = CHARACTER_IDENTITY_COMMENT.exec(content)
  if (!match) return null

  try {
    const parsed = JSON.parse(match[1]) as {
      character_uid?: unknown
      name?: unknown
      profile_stage?: unknown
    }
    const characterUid = typeof parsed.character_uid === 'string' ? parsed.character_uid.trim() : ''
    if (!characterUid) return null
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''
    return { characterUid, name, profileStage: parseProfileStage(parsed.profile_stage) }
  } catch {
    return null
  }
}

/** 从人读渲染中剥除 character_identity 注释行（机器字段不入用户通道） */
function stripCharacterIdentity(content: string): string {
  return content.replace(/^[ \t]*<!--\s*character_identity:[\s\S]*?-->[ \t]*\r?\n?/m, '')
}

function volumeOutlineSource(volumeNumber: number): WorkbenchMarkdownArtifactSource {
  return {
    id: `volume-outline-${volumeNumber}`,
    title: '卷大纲',
    relativePath: volumeOutlinePath(volumeNumber),
  }
}

function rejectInvalidObjectId(): never {
  throw new Error('工作台对象 ID 非法。')
}

function safeFileStem(value: string): string {
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value !== basename(value) ||
    value.includes('/') ||
    value.includes('\\')
  ) {
    rejectInvalidObjectId()
  }
  return value
}

function parsePositiveInteger(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1) rejectInvalidObjectId()
  return parsed
}

function parseWorkbenchObjectId(objectId: string): WorkbenchObjectDescriptor {
  if (objectId === 'master-outline') {
    return {
      kind: 'master-outline',
      title: '全书大纲',
      artifacts: [
        {
          id: 'master-outline',
          title: '全书大纲',
          relativePath: masterOutlinePath(),
          dataRelativePath: outlineStructurePath(),
        },
      ],
    }
  }
  if (objectId === 'narrator-voice') {
    return {
      kind: 'narrator-voice',
      title: '叙事声音',
      artifacts: [
        { id: 'narrator-voice', title: '叙事声音 / 写作风格', relativePath: masterOutlinePath() },
      ],
    }
  }
  if (objectId === 'foundation') {
    return {
      kind: 'foundation',
      title: '创作根基',
      artifacts: [
        {
          id: 'bible-premise',
          title: '核心前提',
          relativePath: premisePath(),
          dataRelativePath: premiseCardsDataPath(),
        },
        { id: 'bible-relationships', title: '关系设定', relativePath: relationshipsPath() },
      ],
    }
  }
  if (objectId === 'bible-premise') {
    return {
      kind: 'bible-document',
      title: '核心前提',
      artifacts: [
        {
          id: 'bible-premise',
          title: '核心前提',
          relativePath: premisePath(),
          dataRelativePath: premiseCardsDataPath(),
        },
      ],
    }
  }
  if (objectId === 'bible-relationships') {
    return {
      kind: 'bible-document',
      title: '关系设定',
      artifacts: [
        { id: 'bible-relationships', title: '关系设定', relativePath: relationshipsPath() },
      ],
    }
  }
  if (objectId === 'characters') {
    return {
      kind: 'character-list',
      title: '小说角色',
      directoryRelativePath: charactersDir(),
      extensions: ['.md'],
      idPrefix: 'character',
    }
  }
  if (objectId === 'world') {
    return {
      kind: 'world-list',
      title: '世界观',
      directoryRelativePath: worldDir(),
      extensions: ['.md'],
      idPrefix: 'world',
    }
  }
  if (objectId === 'references') {
    return {
      kind: 'reference-list',
      title: '参考作品',
      artifacts: [],
    }
  }

  const characterMatch = /^character-(.+)$/.exec(objectId)
  if (characterMatch) {
    const title = safeFileStem(characterMatch[1])
    return {
      kind: 'character',
      title,
      artifacts: [{ id: objectId, title, relativePath: join(charactersDir(), `${title}.md`).split('\\').join('/') }],
    }
  }

  const worldMatch = /^world-(.+)$/.exec(objectId)
  if (worldMatch) {
    const title = safeFileStem(worldMatch[1])
    return {
      kind: 'world',
      title,
      artifacts: [{ id: objectId, title, relativePath: join(worldDir(), `${title}.md`).split('\\').join('/') }],
    }
  }

  const bibleGroupMatch = /^bible-(.+)$/.exec(objectId)
  if (bibleGroupMatch) {
    const dirName = safeFileStem(bibleGroupMatch[1])
    if (reservedBibleDirectoryNames.has(dirName)) rejectInvalidObjectId()

    return {
      kind: 'bible-group',
      title: titleFromBibleDirectory(dirName),
      directoryRelativePath: bibleGroupDir(dirName),
      extensions: ['.md', '.txt'],
      idPrefix: `bible-${dirName}`,
      includeExtensionInId: true,
    }
  }

  const volumeGroupMatch = /^volume-(\d+)$/.exec(objectId)
  if (volumeGroupMatch) {
    const volumeNumber = parsePositiveInteger(volumeGroupMatch[1])
    return {
      kind: 'volume',
      title: `第 ${volumeNumber} 卷`,
      artifacts: [volumeOutlineSource(volumeNumber)],
    }
  }

  const volumeMatch = /^volume-outline-(\d+)$/.exec(objectId)
  if (volumeMatch) {
    const volumeNumber = parsePositiveInteger(volumeMatch[1])
    return {
      kind: 'volume-outline',
      title: '卷大纲',
      artifacts: [volumeOutlineSource(volumeNumber)],
    }
  }

  const chapterMatch = /^chapter-(\d+)$/.exec(objectId)
  if (chapterMatch) {
    const chapterNumber = parsePositiveInteger(chapterMatch[1])
    return {
      kind: 'chapter',
      title: `第 ${String(chapterNumber).padStart(3, '0')} 章`,
      chapterNumber,
    }
  }

  rejectInvalidObjectId()
}

function definitionFromCandidates(
  kind: ArtifactDefinition['kind'],
  title: string,
  candidates: string[],
): ArtifactDefinition {
  const [relativePath, ...fallbackRelativePaths] = candidates
  return { kind, title, relativePath, fallbackRelativePaths }
}

function artifactDefinitions(chapter: number, volume: number): ArtifactDefinition[] {
  return [
    // 章细纲优先读结构化 .json 数据契约（ADR-0018），缺失时回退既有 .md（md 保留）
    definitionFromCandidates('outline', '章节大纲', [
      ...chapterOutlineDataCandidates(volume, chapter),
      ...chapterOutlineCandidates(volume, chapter),
    ]),
    {
      ...definitionFromCandidates('manuscript', '章节正文', chapterManuscriptCandidates(volume, chapter)),
      draftRelativePath: chapterStagingPath(chapter),
    },
    definitionFromCandidates('context-pack', '上下文包', chapterContextPackCandidates(chapter)),
    definitionFromCandidates('review', '审修报告', chapterReviewCandidates(chapter)),
    // 深审标注（/review … deep）：finding-only 人读 markdown，无 verdict、无 JSON 孪生（ADR-0021），
    // 与轻审报告同住 reviews/，审修视图发现并展示两份报告。
    definitionFromCandidates('deep-review', '深审标注', chapterDeepReviewCandidates(chapter)),
  ]
}

function formatJsonParseError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return `JSON 解析失败：${message}`
}

async function loadArtifact(projectPath: string, definition: ArtifactDefinition): Promise<NovelArtifact> {
  const relativePaths = [definition.relativePath, ...(definition.fallbackRelativePaths ?? [])]
  const canonicalPath = join(projectPath, definition.relativePath)

  for (const relativePath of relativePaths) {
    const path = join(projectPath, relativePath)

    try {
      const content = await readFile(path, 'utf-8')

      // 结构化数据契约（.json）解析为 DTO data；人读 .md 回退按 content 渲染。
      // 按扩展名而非 kind 判定：章细纲同一 kind 既有 .json 契约也有 .md 回退。
      if (!path.endsWith('.json')) {
        return {
          kind: definition.kind,
          title: definition.title,
          path,
          exists: true,
          content,
        }
      }

      try {
        return {
          kind: definition.kind,
          title: definition.title,
          path,
          exists: true,
          content,
          data: JSON.parse(content),
        }
      } catch (error) {
        return {
          kind: definition.kind,
          title: definition.title,
          path,
          exists: true,
          content,
          error: formatJsonParseError(error),
        }
      }
    } catch {
      // Try the next accepted NarraCat filename variant.
    }
  }

  if (definition.draftRelativePath) {
    const draftPath = join(projectPath, definition.draftRelativePath)
    try {
      const content = await readFile(draftPath, 'utf-8')
      return {
        kind: definition.kind,
        title: definition.title,
        path: draftPath,
        exists: true,
        content,
        isDraft: true,
      }
    } catch {
      // staging 也没有草稿：走下面常规的 exists:false
    }
  }

  return {
    kind: definition.kind,
    title: definition.title,
    path: canonicalPath,
    exists: false,
  }
}

async function loadWorkbenchMarkdownArtifact(input: {
  id: string
  path: string
  title: string
  dataPath?: string
}): Promise<NovelWorkbenchArtifact> {
  // 结构化数据契约（可选）：提供 dataPath 时附加 DTO data，App 优先从契约渲染（ADR-0018）；
  // 人读 md 仍读取，作为回退与叙述者腔调等 bible 层信息来源。
  let data: unknown
  if (input.dataPath) {
    try {
      const parsed: unknown = JSON.parse(await readFile(input.dataPath, 'utf-8'))
      if (parsed && typeof parsed === 'object') data = parsed
    } catch {
      // 数据契约缺失或损坏：回退人读 md
    }
  }

  let rawContent: string | null = null
  try {
    rawContent = await readFile(input.path, 'utf-8')
  } catch {
    rawContent = null
  }

  const dataFields = data !== undefined ? { data } : {}

  if (rawContent === null) {
    // md 不可读：仅当存在数据契约时仍可展示（纯从 DTO 渲染）
    return {
      id: input.id,
      kind: 'markdown',
      title: input.title,
      path: input.path,
      exists: data !== undefined,
      ...dataFields,
    }
  }

  const isCharacter = input.id.startsWith('character-')
  // 世界观文档常以英文 slug 命名（如 jianghu-rules.md），但正文首标题是中文；
  // 与角色档案同理，展示标题取文档内容而非文件名。
  const isWorld = input.id.startsWith('world-')
  const identity = isCharacter ? parseCharacterIdentity(rawContent) : null
  const content =
    input.id === 'narrator-voice'
      ? extractNarratorVoiceSection(rawContent) ?? ''
      : isCharacter
        ? stripCharacterIdentity(rawContent)
        : rawContent
  const title = isCharacter
    ? identity?.name || titleFromCharacterMarkdown(content) || input.title
    : isWorld
      ? titleFromFirstMarkdownHeading(content) || input.title
      : input.title
  const identityFields = identity
    ? {
        characterUid: identity.characterUid,
        characterName: identity.name,
        characterProfileStage: identity.profileStage,
      }
    : {}
  const displayable =
    data !== undefined ||
    (usesStrictWorkbenchReadiness(input.id)
      ? readStrictMarkdownDocumentReadiness(content) === 'filled'
      : content.trim().length > 0)

  if (!displayable) {
    return {
      id: input.id,
      kind: 'markdown',
      title,
      path: input.path,
      exists: false,
      ...identityFields,
    }
  }

  return {
    id: input.id,
    kind: 'markdown',
    title,
    path: input.path,
    exists: true,
    content,
    ...dataFields,
    ...identityFields,
  }
}

async function listWorkbenchMarkdownArtifacts(input: {
  projectPath: string
  directoryRelativePath: string
  extensions: string[]
  idPrefix: string
  includeExtensionInId?: boolean
}): Promise<NovelWorkbenchArtifact[]> {
  const directoryPath = resolveProjectPath(input.projectPath, input.directoryRelativePath)
  let entries: Dirent[]

  try {
    entries = await readdir(directoryPath, { withFileTypes: true })
  } catch {
    return []
  }

  const extensions = new Set(input.extensions.map((extension) => extension.toLowerCase()))
  const files = entries
    .filter((entry) => entry.isFile() && extensions.has(extname(entry.name).toLowerCase()))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'zh-CN'))

  return Promise.all(
    files.map((fileName) => {
      const title = titleWithoutExtension(fileName)
      const idSuffix = input.includeExtensionInId ? fileName : title

      return loadWorkbenchMarkdownArtifact({
        id: `${input.idPrefix}-${idSuffix}`,
        path: resolveProjectPath(input.projectPath, join(input.directoryRelativePath, fileName)),
        title,
      })
    }),
  )
}

/**
 * 把候选池里待建档的候选角色拼成目录 artifact，追加到「小说角色」目录尾部。
 * - 用 exists:true 让目录展示过滤器纳入（候选实为虚拟项，无文件；渲染端按 isCandidateCharacter 走引导页）。
 * - 已有同名正式档案的候选跳过（已建档/已转正，避免重复）。
 * - 候选池读不到时返回空数组（目录退回只显示已建档角色）。
 */
async function buildCandidateCharacterArtifacts(
  projectPath: string,
  existing: NovelWorkbenchArtifact[],
  openMemoryDb: OpenMemoryDb,
): Promise<NovelWorkbenchArtifact[]> {
  const candidates = await readCandidateCharacters({ projectPath, openMemoryDb })
  if (candidates.length === 0) return []

  const existingNames = new Set<string>()
  for (const artifact of existing) {
    if (artifact.title) existingNames.add(artifact.title)
    if (artifact.characterName) existingNames.add(artifact.characterName)
  }

  return candidates
    .filter((candidate) => !existingNames.has(candidate.name))
    .map((candidate) => ({
      id: `candidate-character-${candidate.characterUid}`,
      kind: 'markdown' as const,
      title: candidate.name,
      exists: true,
      content: `「${candidate.name}」目前是候选角色，尚未建立正式设定档案。`,
      characterUid: candidate.characterUid,
      characterName: candidate.name,
      isCandidateCharacter: true,
      candidateProposedChapter: candidate.proposedChapter,
      candidateNote: candidate.note,
      candidateImportance: candidate.importance,
    }))
}

function resolveProjectPath(projectPath: string, relativePath: string): string {
  const projectRoot = resolve(projectPath)
  const absolutePath = resolve(projectRoot, relativePath)
  const relation = relative(projectRoot, absolutePath)
  if (relation === '' || relation.startsWith('..') || relation === '..' || relation.split(sep).includes('..')) {
    throw new Error('工作台对象路径越界。')
  }
  return absolutePath
}

/**
 * 从书级 outline-structure.json 解析故事线 id→名称映射，供章纲把 storyline_focus
 * 的机器 id 渲染成人读名（#243）。缺契约 / 损坏时返回空映射（章纲降级为人读序号）。
 */
export async function readOutlineStorylineNames(projectPath: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(projectPath, outlineStructurePath()), 'utf-8')
    const parsed = JSON.parse(raw) as { storylines?: Array<{ id?: unknown; name?: unknown }> }
    const names: Record<string, string> = {}
    for (const storyline of parsed.storylines ?? []) {
      if (typeof storyline?.id === 'string' && typeof storyline?.name === 'string' && storyline.name.trim()) {
        names[storyline.id] = storyline.name.trim()
      }
    }
    return names
  } catch {
    return {}
  }
}

/**
 * 从书级 outline-structure.json 的 foreshadowing_registry 解析伏笔 id→描述映射，供章纲把
 * foreshadowing_touch 的「揭示」渲染成「揭示：玉佩」（可读性），与状态页伏笔卡片同源。
 * 缺契约 / 损坏时返回空映射（章纲降级为纯动作，机器 id 不裸露）。
 */
export async function readOutlineForeshadowingDescriptions(projectPath: string): Promise<Record<string, string>> {
  try {
    const raw = await readFile(join(projectPath, outlineStructurePath()), 'utf-8')
    const parsed = JSON.parse(raw) as {
      foreshadowing_registry?: Array<{ id?: unknown; description?: unknown }>
    }
    const descriptions: Record<string, string> = {}
    for (const item of parsed.foreshadowing_registry ?? []) {
      if (typeof item?.id === 'string' && typeof item?.description === 'string' && item.description.trim()) {
        descriptions[item.id] = item.description.trim()
      }
    }
    return descriptions
  } catch {
    return {}
  }
}

export async function loadNovelChapterArtifacts(
  input: LoadNovelChapterArtifactsInput,
): Promise<NovelChapterArtifacts> {
  const volumeNumber = input.volumeNumber ?? 1
  const artifacts = await Promise.all(
    artifactDefinitions(input.chapterNumber, volumeNumber).map((definition) =>
      loadArtifact(input.projectPath, definition),
    ),
  )

  // 章纲结构化 DTO 的 storyline_focus 是机器故事线 id：从书级契约解析 id→名称，附加为派生
  // 展示字段，让章纲渲染人读故事线名而非裸 id（#243），与旧 md「聚焦故事线」对齐。
  const outlineData = artifacts.find((artifact) => artifact.kind === 'outline')?.data
  if (outlineData && typeof outlineData === 'object' && !Array.isArray(outlineData)) {
    const dto = outlineData as Record<string, unknown>
    if (Array.isArray(dto.storyline_focus) && dto.storyline_focus.length > 0) {
      const storylineNames = await readOutlineStorylineNames(input.projectPath)
      if (Object.keys(storylineNames).length > 0) dto.storylineNames = storylineNames
    }
    // 伏笔 id→描述：从书级 registry 解析，供章纲渲染「揭示：玉佩」而非光秃动作（可读性）
    if (Array.isArray(dto.foreshadowing_touch) && dto.foreshadowing_touch.length > 0) {
      const foreshadowingDescriptions = await readOutlineForeshadowingDescriptions(input.projectPath)
      if (Object.keys(foreshadowingDescriptions).length > 0) {
        dto.foreshadowingDescriptions = foreshadowingDescriptions
      }
    }
    // 状态变更维度 key→显示名：从 bible/state-vocabulary.json 解析，供章纲渲染「境界」而非裸 key（A4×D2 片3a）
    if (Array.isArray(dto.state_changes) && dto.state_changes.length > 0) {
      const stateDimensionNames = await readStateDimensionDisplayNames(input.projectPath)
      if (Object.keys(stateDimensionNames).length > 0) {
        dto.stateDimensionNames = stateDimensionNames
      }
    }
  }

  return {
    projectPath: input.projectPath,
    chapterNumber: input.chapterNumber,
    volumeNumber,
    artifacts,
  }
}

export async function loadNovelWorkbenchArtifacts(
  input: LoadNovelWorkbenchArtifactsInput,
  // openMemoryDb 由 IPC handler 注入（运行时才加载 node:sqlite）；省略时不读候选池（测试/无库场景）。
  deps: { openMemoryDb?: OpenMemoryDb } = {},
): Promise<NovelWorkbenchArtifacts> {
  const descriptor = parseWorkbenchObjectId(input.objectId)

  if (descriptor.kind === 'chapter') {
    const chapterArtifacts = await loadNovelChapterArtifacts({
      projectPath: input.projectPath,
      chapterNumber: descriptor.chapterNumber,
      volumeNumber: input.volumeNumber,
    })

    return {
      projectPath: input.projectPath,
      objectId: input.objectId,
      objectKind: descriptor.kind,
      title: descriptor.title,
      artifacts: chapterArtifacts.artifacts.map((artifact) => {
        const id = artifact.kind === 'outline' ? 'chapter-outline' : artifact.kind
        return {
          id,
          kind: id,
          title: artifact.title,
          path: artifact.path,
          exists: artifact.exists,
          content: artifact.content,
          data: artifact.data,
          error: artifact.error,
          isDraft: artifact.isDraft,
        }
      }),
    }
  }

  if ('directoryRelativePath' in descriptor) {
    const artifacts = await listWorkbenchMarkdownArtifacts({
      projectPath: input.projectPath,
      directoryRelativePath: descriptor.directoryRelativePath,
      extensions: descriptor.extensions,
      idPrefix: descriptor.idPrefix,
      includeExtensionInId: descriptor.includeExtensionInId,
    })

    // 「小说角色」目录追加候选角色（候选池里待建档的名字），名字带候选标记、点开走引导页（ADR-0015）。
    if (descriptor.kind === 'character-list' && deps.openMemoryDb) {
      artifacts.push(...(await buildCandidateCharacterArtifacts(input.projectPath, artifacts, deps.openMemoryDb)))
    }

    return {
      projectPath: input.projectPath,
      objectId: input.objectId,
      objectKind: descriptor.kind,
      title: descriptor.title,
      artifacts,
    }
  }

  const referenceWorksSummary =
    descriptor.kind === 'reference-list' ? await getReferenceWorksSummary(input.projectPath) : undefined

  const loadedArtifacts = await Promise.all(
    descriptor.artifacts.map((artifact) =>
      loadWorkbenchMarkdownArtifact({
        id: artifact.id,
        path: resolveProjectPath(input.projectPath, artifact.relativePath),
        title: artifact.title,
        dataPath: artifact.dataRelativePath
          ? resolveProjectPath(input.projectPath, artifact.dataRelativePath)
          : undefined,
      }),
    ),
  )

  return {
    projectPath: input.projectPath,
    objectId: input.objectId,
    objectKind: descriptor.kind,
    // 单文档世界观对象：标题取已加载文档的展示标题（中文首标题），与目录条目对齐，而非英文文件名。
    title: descriptor.kind === 'world' ? loadedArtifacts[0]?.title ?? descriptor.title : descriptor.title,
    artifacts: loadedArtifacts,
    referenceWorksSummary,
  }
}
