/**
 * 正文编辑 diff 分诊（ADR-0031）：纯代码判定一次保存是「纯文字层」（silent）还是
 * 「可能触碰记忆事实」（impact，落盘后浮出第二档评估）。三信号，fail-safe 偏浮出：
 * 1) 实体名：变更句含已知角色名/别名/伏笔关键词；2) 结构：整段新增或删除；
 * 3) 体量：变更字符总量超阈值。三条全不命中才 silent。
 */

export const MANUSCRIPT_EDIT_CHAR_THRESHOLD = 200

export interface ManuscriptDiffHunk {
  removed: string[]
  added: string[]
}

export interface ManuscriptTriage {
  tier: 'silent' | 'impact'
  reasons: string[]
  stats: { addedChars: number; removedChars: number }
  hunks: ManuscriptDiffHunk[]
}

/** 网文正文惯例一行一段：按行切段，去空行与首尾空白。 */
export function splitManuscriptParagraphs(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** 按中文句读（。！？…及英文 !?）切句；连续标点归前句。 */
export function splitManuscriptSentences(paragraph: string): string[] {
  const parts = paragraph.match(/[^。！？!?…]+[。！？!?…]*/g)
  return parts ? parts.map((part) => part.trim()).filter(Boolean) : []
}

/** 最长公共子序列对齐，返回非公共区段列表（removed/added 任一侧可为空 = 纯增删）。 */
export function diffSequences(a: string[], b: string[]): ManuscriptDiffHunk[] {
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const hunks: ManuscriptDiffHunk[] = []
  let removed: string[] = []
  let added: string[] = []
  const flush = () => {
    if (removed.length > 0 || added.length > 0) {
      hunks.push({ removed, added })
      removed = []
      added = []
    }
  }

  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      flush()
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      removed.push(a[i])
      i += 1
    } else {
      added.push(b[j])
      j += 1
    }
  }
  while (i < n) {
    removed.push(a[i])
    i += 1
  }
  while (j < m) {
    added.push(b[j])
    j += 1
  }
  flush()
  return hunks
}

export function triageManuscriptEdit({
  oldText,
  newText,
  entityNames,
}: {
  oldText: string
  newText: string
  entityNames: string[]
}): ManuscriptTriage {
  const hunks = diffSequences(splitManuscriptParagraphs(oldText), splitManuscriptParagraphs(newText))

  let addedChars = 0
  let removedChars = 0
  let structural = false
  const changedSentences: string[] = []

  for (const hunk of hunks) {
    if (hunk.removed.length === 0 || hunk.added.length === 0) {
      // 纯整段新增或删除 = 结构信号
      structural = true
      changedSentences.push(
        ...hunk.removed.flatMap(splitManuscriptSentences),
        ...hunk.added.flatMap(splitManuscriptSentences),
      )
      removedChars += hunk.removed.join('').length
      addedChars += hunk.added.join('').length
      continue
    }
    // 双侧都有 = 段内修改，细化到句级，只把变化句计入实体判定与体量统计
    const sentenceHunks = diffSequences(
      hunk.removed.flatMap(splitManuscriptSentences),
      hunk.added.flatMap(splitManuscriptSentences),
    )
    for (const sentenceHunk of sentenceHunks) {
      changedSentences.push(...sentenceHunk.removed, ...sentenceHunk.added)
      removedChars += sentenceHunk.removed.join('').length
      addedChars += sentenceHunk.added.join('').length
    }
  }

  const reasons: string[] = []
  const hitEntities = [
    ...new Set(entityNames.filter((name) => changedSentences.some((sentence) => sentence.includes(name)))),
  ]
  if (hitEntities.length > 0) {
    const shown = hitEntities.slice(0, 3).map((name) => `「${name}」`).join('、')
    reasons.push(`改动涉及${shown}${hitEntities.length > 3 ? ' 等' : ''}`)
  }
  if (structural) reasons.push('有整段增删')
  if (addedChars + removedChars > MANUSCRIPT_EDIT_CHAR_THRESHOLD) {
    reasons.push(`改动超过 ${MANUSCRIPT_EDIT_CHAR_THRESHOLD} 字`)
  }

  return {
    tier: reasons.length > 0 ? 'impact' : 'silent',
    reasons,
    stats: { addedChars, removedChars },
    hunks,
  }
}
