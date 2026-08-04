import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { ChapterOutlineCardsView } from './ChapterOutlineCardsView'
import type { NovelArtifact } from '@shared/types/novel'

const artifact = {
  kind: 'outline',
  title: '第 003 章',
  path: '/p/outline/vol-01/ch-003.json',
  exists: true,
  data: {
    chapter: 3,
    title: '初入宗门',
    value_shift: '怀疑 → 信任',
    emotional_stakes: '失去引路人',
    dramatic_focus: '当众被羞辱',
    payoff_beat: 'face_slap',
    storyline_focus: ['SL-main'],
    pov_character: { character_uid: 'C-001', name: '苏明' },
    scenes: [{ location: '宗门广场', characters: [{ character_uid: 'C-001', name: '苏明' }], pressure_point: '被点名' }],
    ending_note: '夜里独自练剑',
    foreshadowing_touch: [{ id: 'F-001', action: 'plant' }],
  },
} as unknown as NovelArtifact

describe('ChapterOutlineCardsView · 第一档内联编辑入口', () => {
  test('第一档字段（价值转换）渲染编辑入口', () => {
    const html = renderToStaticMarkup(<ChapterOutlineCardsView artifact={artifact} projectPath="/p" chapter={3} />)
    expect(html).toContain('data-chapter-outline-field-editable="true"')
    expect(html).toContain('价值转换')
    expect(html).toContain('怀疑 → 信任')
  })

  test('第二档字段（本章爽点/聚焦故事线）不渲染编辑入口、但只读展示', () => {
    const html = renderToStaticMarkup(<ChapterOutlineCardsView artifact={artifact} projectPath="/p" chapter={3} />)
    // 第二档字段以中文标签只读展示（不出 editable 标记）
    expect(html).toContain('本章爽点')
    expect(html).toContain('视角人物')
    // 伏笔动作只读展示
    expect(html).toContain('伏笔动作')
    // 精确断言：可编辑标记恰好只出现在 5 个第一档字段，第二档行无该属性
    const editableCount = (html.match(/data-chapter-outline-field-editable="true"/g) ?? []).length
    expect(editableCount).toBe(5)
  })

  test('只读模式（无 projectPath）无编辑入口', () => {
    const html = renderToStaticMarkup(<ChapterOutlineCardsView artifact={artifact} chapter={3} />)
    expect(html).not.toContain('data-chapter-outline-field-editable="true"')
  })
})

const beatArtifact = {
  kind: 'outline',
  title: '第 021 章',
  path: '/p/outline/vol-02/ch-021.json',
  exists: true,
  data: {
    chapter: 21,
    positioning: '主线压力章',
    beats: ['林昭接到战书。', '擂台首回合失利。'],
    must_deliver: ['反派下场立威'],
  },
} as unknown as NovelArtifact

describe('ChapterOutlineCardsView · 新格式 beats 骨架', () => {
  test('positioning 与 beats 条目渲染为可编辑', () => {
    const html = renderToStaticMarkup(<ChapterOutlineCardsView artifact={beatArtifact} projectPath="/p" chapter={21} />)
    expect(html).toContain('本章定位')
    expect(html).toContain('data-chapter-outline-beats="true"')
    expect(html).toContain('data-chapter-outline-field="beats:0"')
    expect(html).toContain('必须交付')
  })
})

const foreshadowingArtifactWithDescription = {
  kind: 'outline',
  title: '第 005 章',
  path: '/p/outline/vol-01/ch-005.json',
  exists: true,
  data: {
    chapter: 5,
    title: '茶馆偶遇',
    foreshadowing_touch: [{ id: 'F-X', action: 'plant' }],
    foreshadowingDescriptions: { 'F-X': '茶馆老板的遗物' },
  },
} as unknown as NovelArtifact

const foreshadowingArtifactWithoutDescription = {
  kind: 'outline',
  title: '第 006 章',
  path: '/p/outline/vol-01/ch-006.json',
  exists: true,
  data: {
    chapter: 6,
    title: '再入宗门',
    foreshadowing_touch: [{ id: 'F-Y', action: 'plant' }],
  },
} as unknown as NovelArtifact

describe('ChapterOutlineCardsView · 伏笔动作补描述（dogfood #7）', () => {
  test('有 foreshadowingDescriptions 映射时渲染「动作：描述」', () => {
    const html = renderToStaticMarkup(
      <ChapterOutlineCardsView artifact={foreshadowingArtifactWithDescription} projectPath="/p" chapter={5} />,
    )
    expect(html).toContain('埋设：茶馆老板的遗物')
    // 只读引用视图，不裸露机器主键
    expect(html).not.toContain('F-X')
  })

  test('无映射时回退纯动作标签，不报错', () => {
    const html = renderToStaticMarkup(
      <ChapterOutlineCardsView artifact={foreshadowingArtifactWithoutDescription} projectPath="/p" chapter={6} />,
    )
    expect(html).toContain('伏笔动作')
    expect(html).toContain('埋设')
    expect(html).not.toContain('埋设：')
    expect(html).not.toContain('F-Y')
  })
})
