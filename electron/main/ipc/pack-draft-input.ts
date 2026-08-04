/**
 * 造包草稿更新 IPC 边界校验（独立模块，供测试直接导入，无重型依赖）。
 *
 * 白名单重建 patch（PR#477 外审 P1-3）：`updatePackDraft` 内部把 `patch.meta` 整个 spread
 * 进既有 meta（见 pack-drafts.ts），此前这里对 IPC 传入的 patch 整对象盲转（`as`），渲染端能
 * 提交 `{meta:{localSource:'created'}}` 洗掉 learned-external 来源锁，再走
 * `exportPackDraftProject` 导出——localSource/learnedFrom/packId/lastPublishedVersion/
 * draftId/derivedFrom 这些字段只允许主进程内部合法调用方（pack-learn.ts/pack-publish.ts 直接
 * 调 updatePackDraft）写，渲染端经这条通用更新 IPC 通道只能改 meta.name/author/description +
 * cards + readme 三类——其余字段一律丢弃，不管渲染端传了什么。
 *
 * cards/compiled 只做「形状」最小校验（字符串字段齐全 + compiled 是对象或 null），内容合法性由
 * pack-compile.ts / pack-publish.ts 的编译与发布校验兜底，这里不重复深查。
 */
import type { DraftCard, PackDraftMeta } from '@shared/types/capability-pack'

type MetaPatch = Pick<PackDraftMeta, 'name' | 'author' | 'description'>
const META_WHITELIST_KEYS = ['name', 'author', 'description'] as const

export interface UpdatePackDraftPatch {
  meta?: Partial<MetaPatch>
  cards?: DraftCard[]
  readme?: string
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return Boolean(input) && typeof input === 'object' && !Array.isArray(input)
}

function readRequiredString(parent: Record<string, unknown>, key: string, message: string): string {
  const value = parent[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(message)
  return value
}

/** meta 白名单重建：只认 name/author/description 三个字符串字段，缺省则不带；其余 key 一律丢弃。 */
function readMetaPatch(raw: unknown): Partial<MetaPatch> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) throw new Error('更新造包草稿参数非法：meta 非法。')
  const result: Partial<MetaPatch> = {}
  for (const key of META_WHITELIST_KEYS) {
    const value = raw[key]
    if (value === undefined) continue
    if (typeof value !== 'string') throw new Error(`更新造包草稿参数非法：meta.${key} 非法。`)
    result[key] = value
  }
  return result
}

/** DraftCard 最小形状校验：cardId/type/name/oneLine/body/intent 为字符串，compiled 为对象或 null。 */
function isValidDraftCardShape(value: unknown): value is DraftCard {
  if (!isRecord(value)) return false
  const stringFields = ['cardId', 'type', 'name', 'oneLine', 'body', 'intent'] as const
  if (!stringFields.every((key) => typeof value[key] === 'string')) return false
  const { compiled } = value
  return compiled === null || (isRecord(compiled) as boolean)
}

function readCardsPatch(raw: unknown): DraftCard[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw) || !raw.every(isValidDraftCardShape)) {
    throw new Error('更新造包草稿参数非法：cards 结构非法。')
  }
  return raw
}

function readReadmePatch(raw: unknown): string | undefined {
  if (raw === undefined) return undefined
  if (typeof raw !== 'string') throw new Error('更新造包草稿参数非法：readme 非法。')
  return raw
}

export function readUpdatePackDraftInput(input: unknown): { draftId: string; patch: UpdatePackDraftPatch } {
  if (!isRecord(input)) throw new Error('更新造包草稿参数非法。')
  const draftId = readRequiredString(input, 'draftId', '更新造包草稿参数非法：缺少 draftId。')
  const patchValue = input.patch
  if (!isRecord(patchValue)) throw new Error('更新造包草稿参数非法：缺少 patch。')

  const meta = readMetaPatch(patchValue.meta)
  const cards = readCardsPatch(patchValue.cards)
  const readme = readReadmePatch(patchValue.readme)

  return {
    draftId,
    patch: {
      ...(meta !== undefined ? { meta } : {}),
      ...(cards !== undefined ? { cards } : {}),
      ...(readme !== undefined ? { readme } : {}),
    },
  }
}
