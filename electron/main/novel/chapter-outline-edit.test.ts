// electron/main/novel/chapter-outline-edit.test.ts
import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  applyChapterOutlineFieldEdit,
  parseChapterOutlineFieldEditInput,
  submitChapterOutlineFieldEdit,
  type ChapterOutlineFieldEdit,
} from './chapter-outline-edit.ts'

function sampleJson() {
  return {
    chapter: 3,
    title: '初入宗门',
    value_shift: '怀疑 → 信任',
    emotional_stakes: '失去唯一的引路人',
    dramatic_focus: '考核台上当众被羞辱',
    storyline_focus: ['SL-main'],
    pov_character: { character_uid: 'C-001', name: '苏明' },
    scenes: [{ location: '宗门广场', characters: [], pressure_point: '被点名' }],
  }
}

function edit(overrides: Partial<ChapterOutlineFieldEdit> = {}): ChapterOutlineFieldEdit {
  return { fieldKey: 'value_shift', newValue: '怀疑 → 决裂', expectedOldValue: '怀疑 → 信任', ...overrides }
}

describe('applyChapterOutlineFieldEdit · 第一档内容编辑', () => {
  test('第一档字段改内容成功、不可变原 json', () => {
    const json = sampleJson()
    const out = applyChapterOutlineFieldEdit(json, edit())
    expect(out.ok).toBe(true)
    if (out.ok) expect(out.payload.value_shift).toBe('怀疑 → 决裂')
    expect(json.value_shift).toBe('怀疑 → 信任') // 原对象未被改
  })

  test('第二档字段拒绝直写', () => {
    const out = applyChapterOutlineFieldEdit(sampleJson(), edit({ fieldKey: 'payoff_beat', expectedOldValue: '', newValue: 'face_slap' }))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain('评估')
  })

  test('空新值拒绝', () => {
    const out = applyChapterOutlineFieldEdit(sampleJson(), edit({ newValue: '  ' }))
    expect(out.ok).toBe(false)
  })

  test('乐观锁：渲染时值与读盘最新不符 → 拒绝并要求刷新', () => {
    const out = applyChapterOutlineFieldEdit(sampleJson(), edit({ expectedOldValue: '已被改写' }))
    expect(out.ok).toBe(false)
    if (!out.ok) expect(out.message).toContain('刷新')
  })
})

describe('applyChapterOutlineFieldEdit · 新格式数组元素编辑', () => {
  const beatJson = () => ({
    chapter: 21,
    positioning: '主线压力章',
    beats: ['林昭接到战书。', '擂台首回合失利。', '亮出金手指反杀。'],
    must_deliver: ['反派下场立威'],
  })

  test('beats 单条按下标直改', () => {
    const out = applyChapterOutlineFieldEdit(beatJson(), {
      fieldKey: 'beats',
      itemIndex: 1,
      newValue: '擂台首回合被压制到崖边。',
      expectedOldValue: '擂台首回合失利。',
    })
    expect(out.ok).toBe(true)
    if (out.ok) expect((out.payload.beats as string[])[1]).toBe('擂台首回合被压制到崖边。')
  })

  test('数组元素乐观锁：expected 不符拒绝', () => {
    const out = applyChapterOutlineFieldEdit(beatJson(), {
      fieldKey: 'beats',
      itemIndex: 1,
      newValue: 'x',
      expectedOldValue: '已经被别人改过的旧值',
    })
    expect(out.ok).toBe(false)
  })

  test('下标越界拒绝', () => {
    const out = applyChapterOutlineFieldEdit(beatJson(), {
      fieldKey: 'beats',
      itemIndex: 9,
      newValue: 'x',
      expectedOldValue: 'y',
    })
    expect(out.ok).toBe(false)
  })

  test('非白名单数组字段（storyline_focus）拒绝', () => {
    const out = applyChapterOutlineFieldEdit(
      { ...beatJson(), storyline_focus: ['SL-main'] },
      { fieldKey: 'storyline_focus', itemIndex: 0, newValue: 'SL-x', expectedOldValue: 'SL-main' },
    )
    expect(out.ok).toBe(false)
  })

  test('positioning 作为第一档标量字段直改', () => {
    const out = applyChapterOutlineFieldEdit(beatJson(), {
      fieldKey: 'positioning',
      newValue: '主线决战前压力蓄积章',
      expectedOldValue: '主线压力章',
    })
    expect(out.ok).toBe(true)
  })
})

describe('parseChapterOutlineFieldEditInput', () => {
  const base = { projectPath: '/p', chapter: 3, fieldKey: 'title', newValue: '新标题', expectedOldValue: '初入宗门' }
  test('合法入参解析', () => {
    const out = parseChapterOutlineFieldEditInput(base)
    expect(out.projectPath).toBe('/p')
    expect(out.chapter).toBe(3)
    expect(out.edit.fieldKey).toBe('title')
  })
  test('章号非正整数抛错', () => {
    expect(() => parseChapterOutlineFieldEditInput({ ...base, chapter: 0 })).toThrow()
  })
})

describe('submitChapterOutlineFieldEdit · glob 定位 + 写 json/md', () => {
  let dir = ''
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'co-edit-'))
    await mkdir(join(dir, 'outline', 'vol-01'), { recursive: true })
    await writeFile(join(dir, 'outline', 'vol-01', 'ch-003.json'), JSON.stringify(sampleJson(), null, 2), 'utf-8')
    await writeFile(join(dir, 'outline', 'vol-01', 'ch-003.md'), '# 第 3 章：初入宗门\n', 'utf-8')
  })
  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  test('成功：写新值进 json + 主进程按新 json 渲染供稿 md', async () => {
    const out = await submitChapterOutlineFieldEdit({
      projectPath: dir,
      chapter: 3,
      edit: edit(),
    })
    expect(out.ok).toBe(true)
    const json = JSON.parse(await readFile(join(dir, 'outline', 'vol-01', 'ch-003.json'), 'utf-8'))
    expect(json.value_shift).toBe('怀疑 → 决裂')
    const md = await readFile(join(dir, 'outline', 'vol-01', 'ch-003.md'), 'utf-8')
    expect(md).toContain('怀疑 → 决裂')
  })

  test('找不到该章 json → 失败', async () => {
    const out = await submitChapterOutlineFieldEdit({ projectPath: dir, chapter: 99, edit: edit() })
    expect(out.ok).toBe(false)
  })

  test('主进程渲染的 md 写入磁盘恰好单个末尾换行（无多余空行）', async () => {
    const out = await submitChapterOutlineFieldEdit({
      projectPath: dir,
      chapter: 3,
      edit: edit(),
    })
    expect(out.ok).toBe(true)
    const md = await readFile(join(dir, 'outline', 'vol-01', 'ch-003.md'), 'utf-8')
    expect(md.endsWith('\n')).toBe(true)
    expect(md.endsWith('\n\n')).toBe(false)
  })

  test('json 文件只读 → writeFile 失败返回 {ok:false}', async () => {
    const jsonPath = join(dir, 'outline', 'vol-01', 'ch-003.json')
    await chmod(jsonPath, 0o444)
    let out: Awaited<ReturnType<typeof submitChapterOutlineFieldEdit>>
    try {
      out = await submitChapterOutlineFieldEdit({
        projectPath: dir,
        chapter: 3,
        edit: edit(),
      })
      expect(out.ok).toBe(false)
      if (!out.ok) expect(out.message).toContain('写入')
    } finally {
      // 先恢复权限才能让 afterEach rm 成功清理
      await chmod(jsonPath, 0o644).catch(() => {})
    }
  })

  test('md 由主进程按读盘最新 json 渲染：加载后被外部追加的 state_changes 不因保存标题而丢失（P1-3 核心场景）', async () => {
    // 模拟场景：渲染进程加载章纲时 json 还是「旧快照」；用户在旧快照上编辑标题前，
    // Agent 已把该章 json 写入了新的 state_changes 节；旧实现会把渲染进程算好的旧快照 md
    // 直接覆盖写盘，导致 Agent 新写的 state_changes 节在 md 里丢失。新实现须按「读盘最新 json」渲染。
    await writeFile(
      join(dir, 'outline', 'vol-01', 'ch-003.json'),
      JSON.stringify(
        {
          ...sampleJson(),
          title: '旧标题',
          state_changes: [{ character: { name: '苏明' }, dimension: 'cultivation_level', operation: 'set', value: '筑基' }],
        },
        null,
        2,
      ),
      'utf-8',
    )
    const out = await submitChapterOutlineFieldEdit({
      projectPath: dir,
      chapter: 3,
      edit: { fieldKey: 'title', newValue: '新标题', expectedOldValue: '旧标题' },
    })
    expect(out.ok).toBe(true)
    const md = await readFile(join(dir, 'outline', 'vol-01', 'ch-003.md'), 'utf-8')
    expect(md).toContain('新标题')
    expect(md).toContain('## 本章状态变更')
  })
})
