import { readFile } from 'node:fs/promises'

export type MarkdownDocumentReadiness = 'blank' | 'template' | 'filled'

// 表格结构行：分隔行 |---|---| 或只含 | : - 空白的行
const tableStructureLine = /^\|?[\s:|-]+\|?$/
// 空字段条目：「- 全名:」标签后没有任何内容
const emptyFieldBullet = /^[-*]\s*[^:：]+[:：]\s*$/
// 整行括号引导语：（用一句话概括整个故事）
const wholeLineGuidance = /^[（(].*[)）]$/
// 占位编号项：「1. 规则一」「2. 规则二」——模板里原样保留，作者绝不会写成真实内容
const placeholderNumberedItem = /^\d+[.、]\s*规则[一二三四五六七八九十]+\s*$/

function isTableSeparatorLine(line: string): boolean {
  return line.includes('|') && tableStructureLine.test(line)
}

/**
 * 判断单行是否属于「模板脚手架」——标题、空字段、括号引导语、表格结构、占位列表项。
 *
 * 这些行在未填写的模板里原样存在，不代表作者已经填写内容。判定依据是字段的
 * 结构形态（是否为空），而不是字段标签或引导词是否出现——后者会把已填写、但
 * 文中自然提到「句式偏好 / 核心矛盾」等词的角色档案误判为模板。
 */
function isScaffoldingLine(line: string, lines: string[], index: number): boolean {
  if (line.length === 0) return true
  if (line.startsWith('#')) return true
  if (emptyFieldBullet.test(line)) return true
  if (wholeLineGuidance.test(line)) return true
  if (isTableSeparatorLine(line)) return true
  // 表头行：紧跟在分隔行之前的 | … | 行。填写后表头仍保留，不算作者内容。
  if (line.startsWith('|') && isTableSeparatorLine(lines[index + 1] ?? '')) return true
  if (placeholderNumberedItem.test(line)) return true
  return false
}

export function hasMeaningfulMarkdownContent(content: string): boolean {
  const lines = content.split('\n').map((line) => line.trim())
  return lines.some((line, index) => !isScaffoldingLine(line, lines, index))
}

export function readStrictMarkdownDocumentReadiness(content: string): MarkdownDocumentReadiness {
  if (content.trim().length === 0) return 'blank'
  return hasMeaningfulMarkdownContent(content) ? 'filled' : 'template'
}

export async function isFilledMarkdownFile(path: string): Promise<boolean> {
  try {
    return readStrictMarkdownDocumentReadiness(await readFile(path, 'utf-8')) === 'filled'
  } catch {
    return false
  }
}
