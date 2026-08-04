// electron/main/packs/pack-local-content.ts
//
// 本机产物卡正文唯一读取入口（审计红线：导入包正文不得经任何路径读取——只有本机来源标记
// [`created`/`learned-own`/`learned-external`]（Task 7 pack-provenance）在案的包，正文才可被
// App 读出展示；纯 `imported` 包（无 provenance 记录）一律 null，防止「导入即可反查作者原始
// 卡正文」这条隐性数据泄漏通道）。同一份 provenance 记录也是 copyPackToDraft「复制为草稿」
// 的权限门：只有 created / learned-own 允许复制派生，learned-external 拒绝（防止「洗掉仅本机
// 标记」——把只许本机用的外部学习成果伪装成自己的原创草稿再发布）。

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, join } from 'node:path'
import { readPackProvenance, type PackProvenanceEntry } from './pack-provenance'
import { findSymlink, isSafePackToken, isSafeRelative, userPacksDir, packVersionDirName } from './pack-store'
import { validatePackManifest } from './pack-manifest'
import { createPackDraft } from './pack-drafts'
import { renderCraftEcho, renderPersonaEcho, renderStructureEcho } from './pack-compile'
import { NARRACAT_AGENT_CORE_VERSION_LOCK } from '../engine/agent-core-contract.ts'
import {
  PACK_README_FILENAME,
  type CompiledCardMeta,
  type DraftCard,
  type LocalPackContent,
  type PackDraftMeta,
  type StructureStage,
} from '@shared/types/capability-pack'

export type { LocalPackContent }

/**
 * 读一个本机包版本的全部卡正文。无 provenance 记录（=纯导入包）一律 null（审计红线，见文件头）；
 * `learned-external`（从外部作品学得）本机仍可读——UI 靠 localSource 标注「仅本机使用」，不在
 * 读取层拦截（拦截的是「复制为草稿再发布」这条通道，见 copyPackToDraft）。
 */
export async function readLocalPackContent(
  input: { userDataPath: string; id: string; version: string },
): Promise<LocalPackContent | null> {
  if (!isSafePackToken(input.id) || !isSafePackToken(input.version)) return null
  const key = `${input.id}@${input.version}`
  // fail-closed（PR#477 P1-4）：provenance 读不出来（IO 错误/JSON 损坏）与「查无 entry」同等对待——
  // 这条通道本就是「无 entry 一律拒绝」的权限门，读取失败不该被解读成「放行」。
  let entry: PackProvenanceEntry | undefined
  try {
    entry = (await readPackProvenance(input.userDataPath))[key]
  } catch {
    return null
  }
  if (!entry) return null

  const dir = join(userPacksDir(input.userDataPath), packVersionDirName(input.id, input.version))
  if (!existsSync(dir)) return null
  // 读取期 symlink 复查（TOCTOU 纵深）：导入期已扫过一次，但已装包目录理论上可被外部进程在
  // 装完之后植入符号链接——读正文这一步再查一次，命中就拒绝，不跟着链接读出包目录之外的文件。
  if (await findSymlink(dir)) {
    console.error(`造包中心：包目录「${dir}」内检测到符号链接，已拒绝读取正文（安全限制）。`)
    return null
  }
  let manifestRaw: unknown
  try {
    manifestRaw = JSON.parse(await readFile(join(dir, 'pack.json'), 'utf8'))
  } catch {
    return null
  }
  const { manifest } = validatePackManifest(manifestRaw)
  if (!manifest) return null

  const cards: Array<{ fileName: string; body: string }> = []
  for (const card of manifest.cards) {
    if (!isSafeRelative(card.path)) continue
    try {
      const body = await readFile(join(dir, card.path), 'utf8')
      cards.push({ fileName: basename(card.path), body })
    } catch {
      // 卡文件缺失/不可读：跳过该条，不阻断其余卡正文展示
    }
  }
  return { localSource: entry.source, cards }
}

/**
 * 从已装本机包反填一份新草稿（「复制为草稿」）：provenance ∈ {created, learned-own} 才允许——
 * learned-external 与无 provenance（imported）一律 null，权限门理由见文件头。
 *
 * compiled 反填裁决（非「置空强制重编译」）：manifest 卡条目本身就带着编译产物的全部字段
 * （path/triggers/keywords/... 都在），直接反填 compiled.fields 让复制出的草稿可以不改动
 * 就再次发布；echo 用 pack-compile.ts 同款确定性渲染函数重算（不信任何持久化的旧 echo 文本）；
 * engineVersion 读当前引擎 lock（复制动作本身就是一次「以当前引擎重新确认」）；intent 置空——
 * 大白话意图这一元信息在发布时就已经不可逆地压缩进结构化字段，无法反向还原，留空等用户想改
 * 字段时重新表达意图触发重编译，不代表卡片不可用。
 */
export async function copyPackToDraft(
  input: { userDataPath: string; id: string; version: string },
): Promise<PackDraftMeta | null> {
  if (!isSafePackToken(input.id) || !isSafePackToken(input.version)) return null
  const key = `${input.id}@${input.version}`
  // fail-closed（PR#477 P1-4），理由同 readLocalPackContent。
  let entry: PackProvenanceEntry | undefined
  try {
    entry = (await readPackProvenance(input.userDataPath))[key]
  } catch {
    console.warn(`造包中心：拒绝复制包「${key}」为草稿——本机来源记录无法读取。`)
    return null
  }
  if (!entry || (entry.source !== 'created' && entry.source !== 'learned-own')) {
    console.warn(
      `造包中心：拒绝复制包「${key}」为草稿——来源须为 created/learned-own，实际为 ${entry?.source ?? '(无 provenance 记录，视为导入包)'}`,
    )
    return null
  }

  const dir = join(userPacksDir(input.userDataPath), packVersionDirName(input.id, input.version))
  if (!existsSync(dir)) return null
  // 读取期 symlink 复查（TOCTOU 纵深），理由同 readLocalPackContent。
  if (await findSymlink(dir)) {
    console.error(`造包中心：包目录「${dir}」内检测到符号链接，已拒绝复制为草稿（安全限制）。`)
    return null
  }
  let manifestRaw: unknown
  try {
    manifestRaw = JSON.parse(await readFile(join(dir, 'pack.json'), 'utf8'))
  } catch {
    return null
  }
  const { manifest } = validatePackManifest(manifestRaw)
  if (!manifest) return null

  const engineVersion = NARRACAT_AGENT_CORE_VERSION_LOCK.version
  const compiledAt = new Date().toISOString()
  const cards: DraftCard[] = []
  for (const card of manifest.cards) {
    if (card.type === 'benchmark') continue // benchmark 卡官方专属，造包中心不支持编辑，跳过不带入草稿
    if (!isSafeRelative(card.path)) continue
    let body: string
    try {
      body = await readFile(join(dir, card.path), 'utf8')
    } catch {
      continue // 卡文件缺失/不可读：跳过，不阻断其余卡复制
    }

    let compiled: CompiledCardMeta
    let name: string
    let oneLine = ''
    if (card.type === 'structure') {
      name = card.id
      oneLine = card.one_line
      compiled = {
        fields: { dimension: card.dimension, stage: card.stage },
        echo: renderStructureEcho(card.stage as StructureStage),
        engineVersion,
        compiledAt,
      }
    } else if (card.type === 'persona') {
      name = card.name
      compiled = {
        fields: { keywords: card.keywords },
        echo: renderPersonaEcho(card),
        engineVersion,
        compiledAt,
      }
    } else {
      name = card.id
      compiled = {
        fields: {
          triggers: card.triggers,
          emotion_tags: card.emotion_tags,
          exclusions: card.exclusions,
          technique_tags: card.technique_tags,
          priority: card.priority,
          beat_types: card.beat_types,
        },
        echo: renderCraftEcho(card),
        engineVersion,
        compiledAt,
      }
    }

    cards.push({ cardId: card.id, type: card.type, name, oneLine, body, intent: '', compiled })
  }

  let readme = ''
  try {
    readme = await readFile(join(dir, PACK_README_FILENAME), 'utf8')
  } catch {
    // README 缺省不算错误，留空
  }

  return createPackDraft({
    userDataPath: input.userDataPath,
    name: `${manifest.name}（复制）`,
    derivedFrom: key,
    seed: { cards, readme, author: manifest.author, description: manifest.description ?? '' },
  })
}
