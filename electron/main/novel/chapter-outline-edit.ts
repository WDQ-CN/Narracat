// electron/main/novel/chapter-outline-edit.ts
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { OUTLINE_DIR, chapterBaseName, legacyChapterBaseName } from './novel-layout.ts'
import { isFirstTierChapterArrayField, isFirstTierChapterField } from '@shared/lib/chapter-outline-field-tier'
import { readOutlineForeshadowingDescriptions, readOutlineStorylineNames } from './novel-artifacts.ts'
import { readStateDimensionDisplayNames } from './character-state.ts'
import { renderChapterOutlineMarkdown, type ChapterOutlineData } from '@shared/lib/outline-structure'

export type ChapterOutlineRaw = Record<string, unknown>

export interface ChapterOutlineFieldEdit {
  /** 章纲顶层字段 key（仅第一档纯描述字段被接受） */
  fieldKey: string
  /** 新内容（trim 后不能为空） */
  newValue: string
  /** 乐观锁——渲染时该字段的值（已 trim） */
  expectedOldValue: string
  /** 新格式（beat 骨架）数组字段的元素下标；缺省 = 标量字段整体替换 */
  itemIndex?: number
}

export interface ChapterOutlineEditRequest {
  projectPath: string
  chapter: number
  edit: ChapterOutlineFieldEdit
}

export type ApplyChapterOutlineEditOutcome =
  | { ok: true; payload: ChapterOutlineRaw }
  | { ok: false; message: string }

export type ChapterOutlineEditResult = { ok: true } | { ok: false; message: string }

/** 纯函数：在章纲 json 上应用一次第一档字段编辑并守边界，返回新 json 或拒绝原因（便于单测）。 */
export function applyChapterOutlineFieldEdit(
  json: ChapterOutlineRaw,
  edit: ChapterOutlineFieldEdit,
): ApplyChapterOutlineEditOutcome {
  // 新格式（beat 骨架）数组元素按下标直改：仅第一档纯描述数组字段（beats/must_deliver）；
  // 增删元素、非白名单数组字段（storyline_focus 等）仍归第二档。
  if (typeof edit.itemIndex === 'number') {
    if (!isFirstTierChapterArrayField(edit.fieldKey)) {
      return { ok: false, message: '该内容有下游影响，需经评估后修改。' }
    }
    const list = json?.[edit.fieldKey]
    if (!Array.isArray(list) || edit.itemIndex < 0 || edit.itemIndex >= list.length) {
      return { ok: false, message: '章纲已更新，请刷新后重试。' }
    }
    const currentItem = (typeof list[edit.itemIndex] === 'string' ? (list[edit.itemIndex] as string) : '').trim()
    if (currentItem !== edit.expectedOldValue.trim()) {
      return { ok: false, message: '章纲已更新，请刷新后重试。' }
    }
    const nextValue = edit.newValue.trim()
    if (nextValue === '') return { ok: false, message: '内容不能为空。' }
    const nextList = [...list]
    nextList[edit.itemIndex] = nextValue
    return { ok: true, payload: { ...json, [edit.fieldKey]: nextList } }
  }

  // 第一档纯描述字段直改（ADR-0029 第一档）；其余一律经 Agent 评估（B2b）。
  if (!isFirstTierChapterField(edit.fieldKey)) {
    return { ok: false, message: '该内容有下游影响，需经评估后修改。' }
  }
  const current = json?.[edit.fieldKey]
  const currentStr = (typeof current === 'string' ? current : '').trim()
  // 乐观锁：读盘最新值须与渲染时一致——Agent 可能在用户点击前改过本字段。
  if (currentStr !== edit.expectedOldValue.trim()) {
    return { ok: false, message: '章纲已更新，请刷新后重试。' }
  }
  const nextValue = edit.newValue.trim()
  if (nextValue === '') return { ok: false, message: '内容不能为空。' }
  return { ok: true, payload: { ...json, [edit.fieldKey]: nextValue } }
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label}参数非法。`)
  return value
}

/** 纯函数：解析 IPC 入参，非法时抛 Error。 */
export function parseChapterOutlineFieldEditInput(input: unknown): ChapterOutlineEditRequest {
  const raw = (input ?? {}) as Record<string, unknown>
  const projectPath = asString(raw.projectPath, '项目路径')
  const chapter = raw.chapter
  if (typeof chapter !== 'number' || !Number.isInteger(chapter) || chapter < 1) {
    throw new Error('章号参数非法。')
  }
  const newValue = asString(raw.newValue, '新内容')
  if (!newValue.trim()) throw new Error('新内容不能为空。')
  const itemIndex = raw.itemIndex
  if (itemIndex !== undefined && (typeof itemIndex !== 'number' || !Number.isInteger(itemIndex) || itemIndex < 0)) {
    throw new Error('条目下标参数非法。')
  }
  return {
    projectPath,
    chapter,
    edit: {
      fieldKey: asString(raw.fieldKey, '字段标识'),
      newValue,
      expectedOldValue: asString(raw.expectedOldValue, '字段内容'),
      ...(typeof itemIndex === 'number' ? { itemIndex } : {}),
    },
  }
}

/**
 * 在 outline/vol-XX/ 下 glob 定位该章的 json 与同名 md（不依赖 volume 入参，匹配「文件即状态」）。
 * 供 planned-state-read.ts 复用以定位该章 state_changes 的 CAS 基线来源 json。
 */
export async function locateChapterOutlineFiles(
  projectPath: string,
  chapter: number,
): Promise<{ jsonPath: string; mdPath: string } | null> {
  const outlineDir = join(projectPath, OUTLINE_DIR)
  let entries
  try {
    entries = await readdir(outlineDir, { withFileTypes: true })
  } catch {
    return null
  }
  const volDirs = entries
    .filter((e) => e.isDirectory() && /^vol-\d+$/.test(e.name))
    .map((e) => e.name)
  const bases = [chapterBaseName(chapter), legacyChapterBaseName(chapter)]
  for (const vol of volDirs) {
    for (const base of bases) {
      const jsonPath = join(outlineDir, vol, `${base}.json`)
      try {
        await readFile(jsonPath, 'utf-8')
        return { jsonPath, mdPath: join(outlineDir, vol, `${base}.md`) }
      } catch {
        // 不在此卷此命名，继续找
      }
    }
  }
  return null
}

/** glob 定位 → 读盘最新 → 守边界应用编辑 → 写 json + 写渲染器供稿的 md（两文件更新）。 */
export async function submitChapterOutlineFieldEdit(
  input: ChapterOutlineEditRequest,
): Promise<ChapterOutlineEditResult> {
  const located = await locateChapterOutlineFiles(input.projectPath, input.chapter)
  if (!located) return { ok: false, message: '未找到该章的章纲数据文件。' }

  let json: ChapterOutlineRaw
  try {
    json = JSON.parse(await readFile(located.jsonPath, 'utf-8')) as ChapterOutlineRaw
  } catch {
    return { ok: false, message: '读取章纲数据失败。' }
  }

  const outcome = applyChapterOutlineFieldEdit(json, input.edit)
  if (!outcome.ok) return outcome

  try {
    // 真相源 json：2 空格缩进 + 末尾换行；key 原序保留（spread 只改目标字段）。
    await writeFile(located.jsonPath, `${JSON.stringify(outcome.payload, null, 2)}\n`, 'utf-8')
    // 只读孪生 md：主进程按「读盘最新 json + 本次编辑」重渲（P1-3——渲染端旧快照不再进写路径）。
    // 派生展示字段只进渲染入参，不落 json。
    const enriched: ChapterOutlineData = { ...(outcome.payload as ChapterOutlineData) }
    const storylineNames = await readOutlineStorylineNames(input.projectPath)
    if (Object.keys(storylineNames).length > 0) enriched.storylineNames = storylineNames
    const foreshadowingDescriptions = await readOutlineForeshadowingDescriptions(input.projectPath)
    if (Object.keys(foreshadowingDescriptions).length > 0) enriched.foreshadowingDescriptions = foreshadowingDescriptions
    const stateDimensionNames = await readStateDimensionDisplayNames(input.projectPath)
    if (Object.keys(stateDimensionNames).length > 0) enriched.stateDimensionNames = stateDimensionNames
    await writeFile(located.mdPath, `${renderChapterOutlineMarkdown(enriched).trimEnd()}\n`, 'utf-8')
  } catch {
    return { ok: false, message: '写入章纲文件失败。' }
  }
  return { ok: true }
}
