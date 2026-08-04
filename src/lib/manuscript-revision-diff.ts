export interface ManuscriptRevisionDiffLine {
  type: 'context' | 'added' | 'removed'
  text: string
  oldLine?: number
  newLine?: number
}

export interface ManuscriptRevisionDiff {
  lines: ManuscriptRevisionDiffLine[]
  addedLines: number
  removedLines: number
  simplified: boolean
}

const MAX_EXACT_DIFF_LINES = 800

function splitLines(text: string): string[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  if (!normalized) return []
  return normalized.split('\n')
}

function simplifiedDiff(before: string[], after: string[]): ManuscriptRevisionDiff {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1
  }

  const lines: ManuscriptRevisionDiffLine[] = []
  for (let index = 0; index < prefix; index += 1) {
    lines.push({ type: 'context', text: before[index]!, oldLine: index + 1, newLine: index + 1 })
  }
  for (let index = prefix; index < before.length - suffix; index += 1) {
    lines.push({ type: 'removed', text: before[index]!, oldLine: index + 1 })
  }
  for (let index = prefix; index < after.length - suffix; index += 1) {
    lines.push({ type: 'added', text: after[index]!, newLine: index + 1 })
  }
  for (let offset = suffix; offset > 0; offset -= 1) {
    const oldIndex = before.length - offset
    const newIndex = after.length - offset
    lines.push({
      type: 'context',
      text: before[oldIndex]!,
      oldLine: oldIndex + 1,
      newLine: newIndex + 1,
    })
  }
  return {
    lines,
    addedLines: after.length - prefix - suffix,
    removedLines: before.length - prefix - suffix,
    simplified: true,
  }
}

/** selected revision → current manuscript 的 line diff；超长正文降级为共同首尾 + 中段块差异。 */
export function diffManuscriptRevision(selectedRevision: string, currentManuscript: string): ManuscriptRevisionDiff {
  const before = splitLines(selectedRevision)
  const after = splitLines(currentManuscript)
  if (before.length > MAX_EXACT_DIFF_LINES || after.length > MAX_EXACT_DIFF_LINES) {
    return simplifiedDiff(before, after)
  }

  const columns = after.length + 1
  const matrix = new Uint32Array((before.length + 1) * columns)
  for (let oldIndex = before.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = after.length - 1; newIndex >= 0; newIndex -= 1) {
      const cell = oldIndex * columns + newIndex
      matrix[cell] =
        before[oldIndex] === after[newIndex]
          ? matrix[(oldIndex + 1) * columns + newIndex + 1]! + 1
          : Math.max(matrix[(oldIndex + 1) * columns + newIndex]!, matrix[oldIndex * columns + newIndex + 1]!)
    }
  }

  const lines: ManuscriptRevisionDiffLine[] = []
  let oldIndex = 0
  let newIndex = 0
  let addedLines = 0
  let removedLines = 0
  while (oldIndex < before.length || newIndex < after.length) {
    if (
      oldIndex < before.length &&
      newIndex < after.length &&
      before[oldIndex] === after[newIndex]
    ) {
      lines.push({
        type: 'context',
        text: before[oldIndex]!,
        oldLine: oldIndex + 1,
        newLine: newIndex + 1,
      })
      oldIndex += 1
      newIndex += 1
      continue
    }
    const removeScore = oldIndex < before.length ? matrix[(oldIndex + 1) * columns + newIndex]! : -1
    const addScore = newIndex < after.length ? matrix[oldIndex * columns + newIndex + 1]! : -1
    if (oldIndex < before.length && removeScore >= addScore) {
      lines.push({ type: 'removed', text: before[oldIndex]!, oldLine: oldIndex + 1 })
      oldIndex += 1
      removedLines += 1
    } else if (newIndex < after.length) {
      lines.push({ type: 'added', text: after[newIndex]!, newLine: newIndex + 1 })
      newIndex += 1
      addedLines += 1
    }
  }
  return { lines, addedLines, removedLines, simplified: false }
}
