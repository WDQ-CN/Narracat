import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  SCHEMA_ENUM_LABEL_BINDINGS,
  getDilemmaMilestoneLabel,
  getForeshadowingActionLabel,
  getForeshadowingTypeLabel,
  getHumanOrdinalLabel,
  getPayoffBeatLabel,
  getPayoffIntensityLabel,
  getPremiseCardTitleLabel,
  getPremiseCertaintyLabel,
  getReviewSeverityLabel,
  getReviewVerdictLabel,
  getStorylineStatusLabel,
  getStorylineTypeLabel,
  isMachinePrimaryKey,
} from './schema-field-labels'

// agent-core schema 真值目录（从本测试文件相对定位到仓库根）
const SCHEMAS_DIR = join(import.meta.dir, '../../agent-core/narracat/schemas')

function loadSchema(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(SCHEMAS_DIR, file), 'utf-8'))
}

function getAtPath(root: unknown, path: readonly string[]): unknown {
  return path.reduce<unknown>((node, key) => {
    if (node && typeof node === 'object') return (node as Record<string, unknown>)[key]
    return undefined
  }, root)
}

/** 递归收集 schema 内所有 enum 出现的 JSON 路径（用于发现未登记 binding 的新 enum 字段）。 */
function collectEnumPaths(node: unknown, path: string[] = [], out: string[][] = []): string[][] {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      if (key === 'enum' && Array.isArray(value)) {
        out.push([...path, key])
      } else {
        collectEnumPaths(value, [...path, key], out)
      }
    }
  }
  return out
}

describe('schema-field-labels · 枚举映射为人读徽标', () => {
  test('storyline.type / status', () => {
    expect(getStorylineTypeLabel('main')).toBe('主线')
    expect(getStorylineTypeLabel('other')).toBe('其他')
    expect(getStorylineStatusLabel('active')).toBe('活跃')
    expect(getStorylineStatusLabel('resolved')).toBe('已收束')
  })

  test('foreshadowing.type / action', () => {
    expect(getForeshadowingTypeLabel('small')).toBe('小伏笔')
    expect(getForeshadowingTypeLabel('major')).toBe('大伏笔')
    expect(getForeshadowingActionLabel('plant')).toBe('埋设')
    expect(getForeshadowingActionLabel('reveal')).toBe('揭示')
  })

  test('dilemma_milestone / payoff_beats', () => {
    expect(getDilemmaMilestoneLabel('value')).toBe('价值')
    expect(getDilemmaMilestoneLabel('existential')).toBe('存在')
    expect(getPayoffBeatLabel('face_slap')).toBe('打脸')
    expect(getPayoffBeatLabel('counterattack')).toBe('逆袭')
  })

  test('payoff_intensity', () => {
    expect(getPayoffIntensityLabel('small')).toBe('小')
    expect(getPayoffIntensityLabel('medium')).toBe('中')
    expect(getPayoffIntensityLabel('large')).toBe('大')
  })

  test('review.severity', () => {
    expect(getReviewSeverityLabel('blocker')).toBe('硬伤')
    expect(getReviewSeverityLabel('note')).toBe('存疑')
  })

  test('premise 卡名 / 确定度（schema 枚举映射；空值→已定，未知降级）', () => {
    expect(getPremiseCardTitleLabel('genre_contract')).toBe('题材读者契约')
    expect(getPremiseCardTitleLabel('narrator_voice')).toBe('叙述声音')
    expect(getPremiseCertaintyLabel('canon')).toBe('已定')
    expect(getPremiseCertaintyLabel('tentative')).toBe('暂定')
    expect(getPremiseCertaintyLabel('open')).toBe('未确定')
    // 空值 / 未标注视为 canon（schema 默认）
    expect(getPremiseCertaintyLabel('')).toBe('已定')
    expect(getPremiseCertaintyLabel('   ')).toBe('已定')
  })

  test('未知枚举值降级为原值，不抛错', () => {
    expect(getStorylineTypeLabel('brand_new_type')).toBe('brand_new_type')
    expect(getPayoffBeatLabel('mystery_beat')).toBe('mystery_beat')
    expect(getReviewSeverityLabel('critical')).toBe('critical')
    expect(getPremiseCardTitleLabel('unknown_card')).toBe('unknown_card')
    // premise 确定度未知非空枚举降级为原值，不误升级为权威「已定」
    expect(getPremiseCertaintyLabel('draft')).toBe('draft')
  })
})

describe('schema-field-labels · 非 ajv 约定值', () => {
  test('审修结果 verdict（大小写不敏感）', () => {
    expect(getReviewVerdictLabel('PASS')).toBe('通过')
    expect(getReviewVerdictLabel('fail')).toBe('未通过')
  })
})

describe('schema-field-labels · 机器主键隐藏 + 人读序号', () => {
  test('识别 storyline / 伏笔 / arc 机器主键', () => {
    expect(isMachinePrimaryKey('SL-revenge')).toBe(true)
    expect(isMachinePrimaryKey('F01')).toBe(true)
    expect(isMachinePrimaryKey('F-CONSPIRACY-01')).toBe(true)
    expect(isMachinePrimaryKey('V01-A02')).toBe(true)
    expect(isMachinePrimaryKey('主角的复仇线')).toBe(false)
  })

  test('人读序号文案', () => {
    expect(getHumanOrdinalLabel('storyline', 2)).toBe('故事线 2')
    expect(getHumanOrdinalLabel('foreshadowing', 1)).toBe('伏笔 1')
    expect(getHumanOrdinalLabel('arc', 3)).toBe('故事弧 3')
  })
})

describe('schema-field-labels · 对照测试（防漂移：schema 枚举 ↔ App 映射 key 一一对应）', () => {
  for (const binding of SCHEMA_ENUM_LABEL_BINDINGS) {
    test(`${binding.field}（${binding.schemaFile}）枚举值集与 App 映射 key 集相等`, () => {
      const schema = loadSchema(binding.schemaFile)
      const enumValues = getAtPath(schema, binding.enumPath)

      // 路径必须命中一个 enum 数组——否则说明 schema 结构漂移、绑定路径失效
      expect(Array.isArray(enumValues)).toBe(true)

      const schemaSet = [...(enumValues as string[])].sort()
      const appSet = Object.keys(binding.labels).sort()

      // 双向相等：schema 有而 App 缺（漏映射）或 App 留 schema 已删枚举（废键）都会失败
      expect(appSet).toEqual(schemaSet)
    })
  }

  // 防新增字段漏检：schema 内每个 enum 字段都必须已登记 binding，否则全新 enum 字段会
  // 静默逃过上面按白名单逐条的对照（手工 binding 列表的盲区）。
  const TARGET_SCHEMA_FILES = ['outline-structure.json', 'review-report.json', 'premise-cards.json'] as const
  for (const file of TARGET_SCHEMA_FILES) {
    test(`${file} 内所有 enum 字段都已登记 binding`, () => {
      const discovered = collectEnumPaths(loadSchema(file))
        .map((segments) => segments.join('/'))
        .sort()
      const registered = SCHEMA_ENUM_LABEL_BINDINGS.filter((binding) => binding.schemaFile === file)
        .map((binding) => binding.enumPath.join('/'))
        .sort()
      // schema 新增整个 enum 字段而未登记 binding → discovered 多出条目 → 失败
      expect(discovered).toEqual(registered)
    })
  }
})

describe('schema-field-labels · 渲染夹具：消费方输出无裸机器字段（ADR-0016）', () => {
  test('含机器字段的样本经映射渲染后，用户通道不残留裸机器字段', () => {
    // 最小 OutlineStructure / ReviewReport 形状样本（携带机器主键与英文枚举原值）
    const storylines = [
      { id: 'SL-revenge', name: '复仇线', type: 'main', status: 'active' },
      { id: 'SL-romance', name: '纠葛线', type: 'romance', status: 'dormant' },
    ]
    const foreshadowings = [
      { id: 'F-CONSPIRACY-01', type: 'major' },
      { id: 'F01', type: 'small' },
    ]
    const arc = { arc_id: 'V01-A01', dilemma_milestone: 'value', payoff_beats: ['face_slap', 'reveal'] }
    const reviewIssues = [{ severity: 'blocker' }, { severity: 'note' }]
    const verdict = 'PASS'

    // 最小消费方：机器主键默认隐藏→人读序号；枚举→中文徽标（不接真实浏览页）
    const lines = [
      ...storylines.map((s, index) => {
        const head = isMachinePrimaryKey(s.id) ? getHumanOrdinalLabel('storyline', index + 1) : s.id
        return `${head} · ${s.name} · ${getStorylineTypeLabel(s.type)} · ${getStorylineStatusLabel(s.status)}`
      }),
      ...foreshadowings.map((f, index) => {
        const head = isMachinePrimaryKey(f.id) ? getHumanOrdinalLabel('foreshadowing', index + 1) : f.id
        return `${head} · ${getForeshadowingTypeLabel(f.type)}`
      }),
      `${isMachinePrimaryKey(arc.arc_id) ? getHumanOrdinalLabel('arc', 1) : arc.arc_id} · ${getDilemmaMilestoneLabel(arc.dilemma_milestone)} · ${arc.payoff_beats.map(getPayoffBeatLabel).join('、')}`,
      ...reviewIssues.map((issue) => getReviewSeverityLabel(issue.severity)),
      getReviewVerdictLabel(verdict),
    ]
    const output = lines.join('\n')

    // 无裸机器主键（storyline SL-* / arc V01-A01 / 伏笔 F* ）
    expect(output).not.toMatch(/SL-|V\d{2}-A\d{2}|F-[A-Z]|F\d/)
    // 无裸英文枚举原值
    expect(output).not.toMatch(/\b(main|romance|active|dormant|major|small|value|face_slap|reveal|blocker|note)\b/)
    // 无裸 verdict
    expect(output).not.toMatch(/\b(PASS|FAIL)\b/)

    // 正向：确实渲染出人读内容
    expect(output).toContain('故事线 1')
    expect(output).toContain('主线')
    expect(output).toContain('故事弧 1')
    expect(output).toContain('通过')
  })
})
