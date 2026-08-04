/** 学习会话 output/cards.json 解析校验（刀4）。单卡 fail-soft 丢弃，全无效才整体失败。 */
import { STRUCTURE_STAGES } from '@shared/types/capability-pack'

export interface LearnedCardOutput {
  type: 'persona' | 'craft' | 'structure'
  name: string
  oneLine: string
  body: string
  intent: string
}

export interface LearnOutput {
  cards: LearnedCardOutput[]
  properNouns: string[]
  droppedCount: number
  /** 顶层 `pack_name`（可选；作家向导产出携带，学习产出没有）。trim 后为空或非字符串一律视为缺省。 */
  packName?: string
}

const CARD_TYPES = new Set(['persona', 'craft', 'structure'])

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

export function parseLearnOutput(raw: string): { ok: true; output: LearnOutput } | { ok: false; reason: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: '学习结果不是合法 JSON。' }
  }
  const root = parsed as { cards?: unknown; proper_nouns?: unknown; pack_name?: unknown }
  if (!Array.isArray(root.cards) || root.cards.length === 0) {
    return { ok: false, reason: '学习结果里没有卡。' }
  }
  const dropped: string[] = []
  const cards: LearnedCardOutput[] = []
  let personaSeen = false
  for (const item of root.cards) {
    if (item === null || typeof item !== 'object') {
      dropped.push('（无名卡）')
      continue
    }
    const c = item as Record<string, unknown>
    const type = c.type as string
    if (
      !CARD_TYPES.has(type) ||
      !isNonEmptyString(c.name) ||
      !isNonEmptyString(c.one_line) ||
      !isNonEmptyString(c.body) ||
      !isNonEmptyString(c.intent) ||
      (type === 'structure' && !(STRUCTURE_STAGES as readonly string[]).includes(c.intent as string))
    ) {
      dropped.push(isNonEmptyString(c.name) ? (c.name as string) : '（无名卡）')
      continue
    }
    if (type === 'persona') {
      if (personaSeen) {
        dropped.push(c.name as string)
        continue
      } // 腔调卡书级唯一
      personaSeen = true
    }
    cards.push({
      type: type as LearnedCardOutput['type'],
      name: (c.name as string).trim(),
      oneLine: (c.one_line as string).trim(),
      body: c.body as string,
      intent: (c.intent as string).trim(),
    })
  }
  if (cards.length === 0) return { ok: false, reason: `学习结果里没有可用的卡（${dropped.length} 张格式不合格）。` }
  const properNouns = Array.isArray(root.proper_nouns) ? (root.proper_nouns as unknown[]).filter(isNonEmptyString) : []
  const packName = isNonEmptyString(root.pack_name) ? root.pack_name.trim() : undefined
  return { ok: true, output: { cards, properNouns, droppedCount: dropped.length, ...(packName ? { packName } : {}) } }
}
