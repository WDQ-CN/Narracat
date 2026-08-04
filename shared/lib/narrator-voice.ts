export interface NarratorVoiceReferenceExample {
  sourceExcerpt: string
  mechanismNote?: string
}

export interface NarratorVoiceSummary {
  sectionMarkdown: string
  archetype?: string
  pacing?: string
  ornamentation?: string
  digression?: string
  address?: string
  tone?: string
  styleKeywords?: string
  referenceInspiration?: string
  referenceExamples?: NarratorVoiceReferenceExample[]
}

export function hasNarratorVoiceSection(content: string): boolean {
  return /^##\s+叙述者腔调.*$/m.test(content)
}

export function extractNarratorVoiceSection(content: string): string | null {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex((line) => /^##\s+叙述者腔调.*$/.test(line.trim()))
  if (start === -1) return null

  const nextSection = lines.findIndex((line, index) => index > start && /^##\s+\S/.test(line.trim()))
  const end = nextSection === -1 ? lines.length : nextSection
  const section = lines.slice(start, end).join('\n').trim()

  return section || null
}

/**
 * 去掉正文里的「## 叙述者腔调」整段。该段已被 NarratorVoiceSummary 解析成结构化摘要展示，
 * 正文若再原样渲染同一份 bullet 列表就与摘要重复（dogfood 反馈 #叙事声音页）。
 * 找不到该段时原样返回，便于调用方无脑套用。
 */
export function removeNarratorVoiceSection(content: string): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const start = lines.findIndex((line) => /^##\s+叙述者腔调.*$/.test(line.trim()))
  if (start === -1) return content

  const nextSection = lines.findIndex((line, index) => index > start && /^##\s+\S/.test(line.trim()))
  const end = nextSection === -1 ? lines.length : nextSection
  const remaining = [...lines.slice(0, start), ...lines.slice(end)].join('\n')

  return remaining.replace(/\n{3,}/g, '\n\n').trim()
}

export function parseNarratorVoiceSummary(content: string): NarratorVoiceSummary | null {
  const sectionMarkdown = extractNarratorVoiceSection(content) ?? (hasNarratorVoiceSection(content) ? content.trim() : '')
  if (!sectionMarkdown) return null

  return {
    sectionMarkdown,
    archetype: readBoldListValue(sectionMarkdown, 'archetype'),
    pacing: readNestedListValue(sectionMarkdown, 'pacing'),
    ornamentation: readNestedListValue(sectionMarkdown, 'ornamentation'),
    digression: readNestedListValue(sectionMarkdown, 'digression'),
    address: readNestedListValue(sectionMarkdown, 'address'),
    tone: readNestedListValue(sectionMarkdown, 'tone'),
    styleKeywords: readNestedListValue(sectionMarkdown, 'style_keywords'),
    referenceInspiration: readBoldListValue(sectionMarkdown, 'reference_inspiration'),
    referenceExamples: readReferenceExamples(sectionMarkdown),
  }
}

function readBoldListValue(content: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*-\\s+\\*\\*${escapeRegExp(key)}\\*\\*\\s*:\\s*(.+)$`, 'm').exec(content)
  return cleanNarratorVoiceValue(match?.[1])
}

function readNestedListValue(content: string, key: string): string | undefined {
  const match = new RegExp(`^\\s*-\\s+${escapeRegExp(key)}\\s*:\\s*(.+)$`, 'm').exec(content)
  return cleanNarratorVoiceValue(match?.[1])
}

/**
 * Parse the `reference_examples` block — 1-3 去文本化范例块, each a
 * `source_excerpt` (the mechanism description) plus an optional `mechanism_note`.
 * The renderer-only summary parser used to drop this block entirely, silently
 * losing the part that best conveys the narrator's real voice.
 */
function readReferenceExamples(content: string): NarratorVoiceReferenceExample[] | undefined {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const headerIndex = lines.findIndex((line) => /^\s*-\s+\*\*reference_examples\*\*/.test(line))
  if (headerIndex === -1) return undefined

  const examples: NarratorVoiceReferenceExample[] = []

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? ''

    // A new top-level bold field ends the reference_examples block.
    if (/^\s*-\s+\*\*[^*]+\*\*/.test(line)) break

    const sourceMatch = /source_excerpt\s*[:：]\s*(.+)$/.exec(line)
    if (sourceMatch) {
      const sourceExcerpt = cleanNarratorVoiceValue(sourceMatch[1])
      if (sourceExcerpt) examples.push({ sourceExcerpt })
      continue
    }

    const mechanismMatch = /mechanism_note\s*[:：]\s*(.+)$/.exec(line)
    const current = examples[examples.length - 1]
    if (mechanismMatch && current) {
      const mechanismNote = cleanNarratorVoiceValue(mechanismMatch[1])
      if (mechanismNote) current.mechanismNote = mechanismNote
    }
  }

  return examples.length > 0 ? examples : undefined
}

function cleanNarratorVoiceValue(value: string | undefined): string | undefined {
  const cleaned = value
    ?.replace(/^\[(.*)\]$/, '$1')
    .replace(/[{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  return cleaned || undefined
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
