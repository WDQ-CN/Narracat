// App 侧能力包 pack.json 契约校验：复刻引擎 Task 1
// `agent-core/narracat/mcp-server/src/packs/pack-manifest.ts` 的校验规则（同名函数 `validatePackManifest`、
// 同语义）。App 只依赖共享契约类型（`shared/types/capability-pack.ts`），不跨界 import 引擎源码——
// 两侧各自维护一份同形状校验逻辑，任何一侧改校验规则须同步另一侧（无自动化同步机制，人工对齐）。

import {
  isPackLicense,
  PACK_FORMAT_VERSION,
  SEMVER_RE,
  STRUCTURE_STAGES,
  type PackCardEntry,
  type PackLicense,
  type PackManifest,
  type StructureStage,
} from '@shared/types/capability-pack'
import { isSafePackToken } from './pack-token'

export type { PackManifest, PackCardEntry }

const KNOWN_CARD_TYPES = new Set(['persona', 'craft', 'structure', 'benchmark'])

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}
function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string')
}

export function validatePackManifest(raw: unknown): { manifest: PackManifest | null; errors: string[]; warnings: string[] } {
  const errors: string[] = []
  const warnings: string[] = []
  if (typeof raw !== 'object' || raw === null) return { manifest: null, errors: ['manifest 不是对象'], warnings }
  const m = raw as Record<string, unknown>

  if (m.pack_format_version !== PACK_FORMAT_VERSION) errors.push(`pack_format_version 不支持（须为 ${PACK_FORMAT_VERSION}）`)
  if (!isNonEmptyString(m.id)) errors.push('id 缺失或为空')
  // id 会被直接拼进磁盘路径（`<id>@<version>`，见 pack-store.ts packVersionDirName）——放行 `/`、`..`
  // 之类片段会导致导入/发布/卸载/导出全线路径穿越出对应根目录，故此处与 pack-store.ts 导入校验序
  // 用同一份 isSafePackToken（定义于 pack-token.ts，避免与 pack-store.ts 循环依赖）。
  else if (!isSafePackToken(m.id)) errors.push('id 含非法字符（仅允许字母数字与 `._-`，且首字符不可为符号）')
  if (!isNonEmptyString(m.name)) errors.push('name 缺失或为空')
  if (!isNonEmptyString(m.author)) errors.push('author（署名）缺失或为空')
  if (!isNonEmptyString(m.version)) errors.push('version 缺失或为空')
  else if (!SEMVER_RE.test(m.version)) errors.push('version 不是合法 SemVer（不支持 build metadata）')
  if (!Array.isArray(m.cards)) errors.push('cards 缺失或不是数组')

  const cards: PackCardEntry[] = []
  const seenCardIds = new Set<string>()
  if (Array.isArray(m.cards)) {
    for (const [i, rawCard] of m.cards.entries()) {
      const c = rawCard as Record<string, unknown>
      const label = `cards[${i}]`
      if (typeof c !== 'object' || c === null || !isNonEmptyString(c.type)) { errors.push(`${label} 非法`); continue }
      if (!KNOWN_CARD_TYPES.has(c.type)) { warnings.push(`${label} 未知卡类型「${c.type}」已跳过`); continue }
      if (!isNonEmptyString(c.path) || !isNonEmptyString(c.id)) { errors.push(`${label} 缺 path 或 id`); continue }
      if (c.type === 'persona') {
        if (!isNonEmptyString(c.name) || !isStringArray(c.keywords)) { errors.push(`${label} persona 卡缺 name/keywords`); continue }
      } else if (c.type === 'craft') {
        const arrays = [c.triggers, c.beat_types, c.technique_tags, c.emotion_tags, c.exclusions]
        if (!arrays.every(isStringArray) || typeof c.priority !== 'number') { errors.push(`${label} craft 卡元数据不全`); continue }
      } else if (c.type === 'structure') {
        if (!isNonEmptyString(c.dimension) || !isNonEmptyString(c.one_line)
          || !STRUCTURE_STAGES.includes(c.stage as StructureStage)) { errors.push(`${label} structure 卡缺 dimension/stage/one_line 或 stage 非法`); continue }
      } else if (c.type === 'benchmark') {
        if (!isNonEmptyString(c.genre)) { errors.push(`${label} benchmark 卡缺 genre`); continue }
      }
      if (seenCardIds.has(c.id as string)) { errors.push(`${label} 卡 id「${c.id as string}」在包内重复`); continue }
      seenCardIds.add(c.id as string)
      cards.push(c as unknown as PackCardEntry)
    }
  }
  // license 非法值降级为 warning，不 fail-loud——导入宽容（权利元数据，ADR-0034）。
  let license: PackLicense | undefined
  if (m.license !== undefined) {
    if (isPackLicense(m.license)) license = m.license
    else warnings.push(`license 值「${String(m.license)}」不是已知授权类型，已忽略`)
  }

  if (errors.length > 0) return { manifest: null, errors, warnings }
  return {
    manifest: {
      pack_format_version: PACK_FORMAT_VERSION,
      id: m.id as string, name: m.name as string, author: m.author as string,
      version: m.version as string,
      ...(isNonEmptyString(m.description) ? { description: m.description } : {}),
      ...(isNonEmptyString(m.min_engine_version) ? { min_engine_version: m.min_engine_version } : {}),
      ...(isNonEmptyString(m.changelog) ? { changelog: m.changelog } : {}),
      ...(isNonEmptyString(m.publisher_id) ? { publisher_id: m.publisher_id } : {}),
      ...(isNonEmptyString(m.content_hash) ? { content_hash: m.content_hash } : {}),
      ...(license ? { license } : {}),
      ...(isNonEmptyString(m.derived_from) ? { derived_from: m.derived_from } : {}),
      cards,
    },
    errors, warnings,
  }
}
