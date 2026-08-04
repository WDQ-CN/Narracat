import { describe, expect, test } from 'bun:test'
import {
  AGENT_BODY_CLASS,
  AGENT_QUESTION_INPUT_CLASS,
  AGENT_QUESTION_OPTION_CLASS,
  AGENT_QUESTION_TITLE_CLASS,
  EMPTY_COMPACT_BODY_CLASS,
  EMPTY_COMPACT_TITLE_CLASS,
  EMPTY_PRIMARY_BODY_CLASS,
  EMPTY_PRIMARY_TITLE_CLASS,
  METADATA_TEXT_CLASS,
} from './typography'

const roles = [
  EMPTY_PRIMARY_TITLE_CLASS,
  EMPTY_PRIMARY_BODY_CLASS,
  EMPTY_COMPACT_TITLE_CLASS,
  EMPTY_COMPACT_BODY_CLASS,
  METADATA_TEXT_CLASS,
  AGENT_BODY_CLASS,
  AGENT_QUESTION_TITLE_CLASS,
  AGENT_QUESTION_OPTION_CLASS,
  AGENT_QUESTION_INPUT_CLASS,
]

describe('typography role contract', () => {
  test('primary empty state reads as main content, not metadata', () => {
    // 主空态标题用页面标题级 text-lg，说明用 text-sm leading-6，避免主内容看起来像元数据。
    expect(EMPTY_PRIMARY_TITLE_CLASS).toContain('text-lg')
    expect(EMPTY_PRIMARY_TITLE_CLASS).toContain('text-foreground')
    expect(EMPTY_PRIMARY_BODY_CLASS).toContain('text-sm')
    expect(EMPTY_PRIMARY_BODY_CLASS).toContain('leading-6')
  })

  test('compact and metadata roles stay at the text-xs scale', () => {
    expect(EMPTY_COMPACT_TITLE_CLASS).toContain('text-sm')
    expect(EMPTY_COMPACT_BODY_CLASS).toContain('text-xs')
    expect(METADATA_TEXT_CLASS).toContain('text-xs')
  })

  test('agent body uses the governed text-[15px] peak', () => {
    expect(AGENT_BODY_CLASS).toContain('text-[15px]')
  })

  test('agent question title, options and input reach at least text-sm', () => {
    expect(AGENT_QUESTION_TITLE_CLASS).toContain('text-sm')
    expect(AGENT_QUESTION_OPTION_CLASS).toContain('text-sm')
    expect(AGENT_QUESTION_INPUT_CLASS).toContain('text-sm')
  })

  test('does not reintroduce forbidden palette text classes', () => {
    for (const role of roles) {
      expect(role).not.toMatch(/text-(blue|purple|green|orange|red|gray|slate)-/)
    }
  })
})
