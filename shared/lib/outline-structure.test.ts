import { describe, expect, test } from 'bun:test'
import {
  isNewFormatChapterOutline,
  renderChapterOutlineMarkdown,
  renderOutlineStructureMarkdown,
  renderOutlineVolumesMarkdown,
  type ChapterOutlineData,
  type OutlineStructureData,
} from './outline-structure'

const BOOK: OutlineStructureData = {
  central_dramatic_question: '林晚能否在宗门覆灭前找出内奸?',
  protagonist_core_desire: '重铸断剑、洗清师父污名',
  protagonist_core_lack: '不敢信任自己的判断',
  antagonistic_force: '执法堂首座暗中勾结魔宗',
  stakes_progression: '卷1失去信任→卷2失去传承→卷3面对真相',
  storylines: [
    { id: 'SL-main', name: '内奸与剑脉', type: 'main', priority: 1, entry_chapter: 1, planned_payoff_chapter: 60 },
    { id: 'SL-growth', name: '断剑重铸', type: 'growth', priority: 2, entry_chapter: 2 },
    { id: 'SL-rival', name: '大师兄之争', type: 'rivalry', priority: 3, entry_chapter: 4, status: 'dormant' },
  ],
  foreshadowing_registry: [
    {
      id: 'F-TRAITOR',
      type: 'major',
      description: '执法堂首座袖口的魔宗火纹刺青',
      planted_chapter: 3,
      target_reveal: '55',
      theme_link: '内奸身份直指中心问题',
    },
    { id: 'S-HERB', type: 'small', description: '药圃缺失的三株血参', planted_chapter: 1, target_reveal: 'vol-08' },
  ],
  volumes: [
    {
      volume_no: 1,
      title: '杂役峰',
      dilemma_milestone: 'choice',
      arc_list: [
        {
          arc_id: 'V01-A01',
          title: '药圃失窃案',
          chapter_start: 1,
          chapter_end: 12,
          core_question: '林晚能否自证清白?',
          irreversible_change: '被调入剑冢做杂役',
          next_arc_seed: '断剑月圆夜剑鸣',
          payoff_beats: ['face_slap', 'level_up'],
        },
      ],
    },
  ],
}

describe('renderOutlineStructureMarkdown（书级）', () => {
  test('引擎字段 + 故事线/伏笔/卷章树分区块渲染', () => {
    const md = renderOutlineStructureMarkdown(BOOK)
    expect(md).toContain('## 故事引擎')
    expect(md).toContain('**中心戏剧问题**：林晚能否在宗门覆灭前找出内奸?')
    expect(md).toContain('## 故事线')
    expect(md).toContain('内奸与剑脉')
    expect(md).toContain('## 伏笔注册表')
    expect(md).toContain('## 卷章结构')
    expect(md).toContain('### 杂役峰')
    expect(md).toContain('药圃失窃案')
  })

  test('枚举经 #243 映射成中文徽标，不裸露英文枚举', () => {
    const md = renderOutlineStructureMarkdown(BOOK)
    expect(md).toContain('主线')
    expect(md).toContain('成长线')
    expect(md).toContain('宿敌线')
    expect(md).toContain('蛰伏') // storyline status dormant
    expect(md).toContain('大伏笔') // foreshadowing major
    expect(md).toContain('小伏笔')
    expect(md).toContain('困境里程碑：抉择') // dilemma choice
    expect(md).toContain('打脸')
    expect(md).toContain('升级')
    expect(md).not.toMatch(/\b(main|growth|rivalry|dormant|major|small|choice|face_slap|level_up)\b/)
  })

  test('机器主键 SL-* / F* / V01-A01 不进用户通道，替换为人读序号', () => {
    const md = renderOutlineStructureMarkdown(BOOK)
    expect(md).not.toContain('SL-main')
    expect(md).not.toContain('SL-growth')
    expect(md).not.toContain('F-TRAITOR')
    expect(md).not.toContain('S-HERB')
    expect(md).not.toContain('V01-A01')
    expect(md).toContain('故事线 1')
    expect(md).toContain('伏笔 1')
    expect(md).toContain('故事弧 1')
  })

  test('伏笔兑现锚点：章号与卷级粗锚点都人读化', () => {
    const md = renderOutlineStructureMarkdown(BOOK)
    expect(md).toContain('埋设第 3 章 → 兑现 第 55 章')
    expect(md).toContain('兑现 第 8 卷') // vol-08
  })

  test('故事线收线/入场章号渲染', () => {
    const md = renderOutlineStructureMarkdown(BOOK)
    expect(md).toContain('第 1 章入场，计划第 60 章收线')
    expect(md).toContain('第 2 章入场')
  })

  test('空契约降级不报错', () => {
    expect(typeof renderOutlineStructureMarkdown({})).toBe('string')
    expect(renderOutlineStructureMarkdown({})).toContain('缺失或为空')
  })

  test('卷标题缺失时合成「第 N 卷」（backfill 尽力重建场景）', () => {
    const md = renderOutlineStructureMarkdown({
      volumes: [{ volume_no: 2, arc_list: [{ arc_id: 'V02-A01', title: '无名弧', chapter_start: 13, chapter_end: 24 }] }],
    })
    expect(md).toContain('### 第 2 卷')
    expect(md).toContain('第 13-24 章')
  })

  test('arc.antagonist_agent 有值时渲染施压者行（issue #429）', () => {
    const md = renderOutlineStructureMarkdown({
      volumes: [
        {
          volume_no: 1,
          arc_list: [
            {
              arc_id: 'V01-A01',
              title: '药圃失窃案',
              chapter_start: 1,
              chapter_end: 12,
              antagonist_agent: '药圃管事',
            },
          ],
        },
      ],
    })
    expect(md).toContain('施压者：药圃管事')
  })

  test('arc.antagonist_agent 缺失时不渲染施压者行', () => {
    const md = renderOutlineStructureMarkdown(BOOK)
    expect(md).not.toContain('施压者')
  })

  test('volumes 为空数组（书级待展开中间态）：书级区块照常渲染、卷章结构整段省略、不抛错', () => {
    const md = renderOutlineStructureMarkdown({ ...BOOK, volumes: [] })
    expect(md).toContain('## 故事引擎')
    expect(md).toContain('## 故事线')
    expect(md).toContain('## 伏笔注册表')
    expect(md).not.toContain('## 卷章结构')
    expect(renderOutlineVolumesMarkdown({ ...BOOK, volumes: [] })).toBe('')
  })
})

const CHAPTER: ChapterOutlineData = {
  chapter: 5,
  title: '剑冢夜鸣',
  value_shift: '怀疑→确信',
  emotional_stakes: '可能失去唯一的同盟赵伯',
  dramatic_focus: '林晚在封冢前夺回剑芯玉符',
  payoff_beat: 'reveal',
  storyline_focus: ['SL-main', 'SL-rival'],
  pov_character: { character_uid: '11111111-1111-4111-8111-111111111111', name: '林晚' },
  ending_note: '玉符只有一半，另一半在魔宗手里',
  scenes: [
    {
      location: '剑冢',
      characters: [
        { character_uid: '11111111-1111-4111-8111-111111111111', name: '林晚' },
        { character_uid: '22222222-2222-4222-8222-222222222222', name: '赵伯' },
      ],
      pressure_point: '执法堂封印将合，林晚必须抢在最后一刻取符',
    },
  ],
  foreshadowing_touch: [
    { id: 'F-SWORD-CORE', action: 'reveal' },
    { id: 'F-TRAITOR', action: 'develop' },
  ],
}

describe('renderChapterOutlineMarkdown（章级）', () => {
  test('标题 + 章核字段 + 场景分区块渲染', () => {
    const md = renderChapterOutlineMarkdown(CHAPTER)
    expect(md).toContain('# 第 5 章：剑冢夜鸣')
    expect(md).toContain('**价值转换**：怀疑→确信')
    expect(md).toContain('**情感赌注**：可能失去唯一的同盟赵伯')
    expect(md).toContain('**戏剧焦点**：')
    expect(md).toContain('**本章爽点**：反转')
    expect(md).toContain('**视角人物**：林晚')
    expect(md).toContain('**章末收尾**：玉符只有一半')
    expect(md).toContain('## 场景')
    expect(md).toContain('### 场景 1 · 剑冢')
    expect(md).toContain('出场角色：林晚、赵伯')
    expect(md).toContain('压力点：执法堂封印将合')
  })

  test('聚焦故事线：有 id→名称映射时渲染人读故事线名', () => {
    const md = renderChapterOutlineMarkdown({
      ...CHAPTER,
      storylineNames: { 'SL-main': '内奸与剑脉', 'SL-rival': '大师兄之争' },
    })
    expect(md).toContain('**聚焦故事线**：内奸与剑脉、大师兄之争')
    expect(md).not.toContain('SL-main')
    expect(md).not.toContain('故事线 1')
  })

  test('聚焦故事线：缺名称映射时降级为人读序号，机器 id 不裸露', () => {
    const md = renderChapterOutlineMarkdown(CHAPTER) // 无 storylineNames
    expect(md).toContain('**聚焦故事线**：故事线 1、故事线 2')
    expect(md).not.toContain('SL-main')
    expect(md).not.toContain('SL-rival')
  })

  test('伏笔动作经 #243 映射，机器 id 与 UID 不裸露', () => {
    const md = renderChapterOutlineMarkdown(CHAPTER)
    expect(md).toContain('## 伏笔动作')
    expect(md).toContain('揭示') // reveal
    expect(md).toContain('推进') // develop
    expect(md).not.toContain('F-SWORD-CORE')
    expect(md).not.toContain('F-TRAITOR')
    expect(md).not.toContain('SL-main') // storyline_focus 机器 id 不裸露
    expect(md).not.toContain('11111111-1111-4111-8111-111111111111') // character_uid 不裸露
    expect(md).not.toMatch(/\b(reveal|develop|plant)\b/)
  })

  test('缺 chapter 号 / 缺标题时降级渲染', () => {
    expect(renderChapterOutlineMarkdown({ value_shift: '甲→乙' })).toContain('# 章节细纲')
    expect(renderChapterOutlineMarkdown({ chapter: 3 })).toContain('# 第 3 章细纲')
  })

  test('payoff_beat 为空（蓄压章）时不渲染本章爽点行', () => {
    const { payoff_beat: _omit, ...withoutBeat } = CHAPTER
    const md = renderChapterOutlineMarkdown(withoutBeat)
    expect(md).not.toContain('**本章爽点**')
  })

  test('payoff_intensity 有值时附加强度标签（issue #429）', () => {
    const md = renderChapterOutlineMarkdown({ ...CHAPTER, payoff_intensity: 'large' })
    expect(md).toContain('**本章爽点**：反转 · 强度：大')
  })

  test('payoff_beat 有值但 payoff_intensity 缺失时不附加强度标签', () => {
    const md = renderChapterOutlineMarkdown(CHAPTER)
    expect(md).toContain('**本章爽点**：反转')
    expect(md).not.toContain('强度')
  })

  test('伏笔动作有描述时显「动作：描述」，缺描述回退纯动作（新旧共享）', () => {
    const md = renderChapterOutlineMarkdown({
      ...CHAPTER,
      foreshadowingDescriptions: { 'F-SWORD-CORE': '剑芯玉符' },
    })
    expect(md).toContain('- 揭示：剑芯玉符') // F-SWORD-CORE 有描述
    expect(md).toContain('- 推进') // F-TRAITOR 无描述 → 回退纯动作
    expect(md).not.toContain('F-SWORD-CORE') // 机器 id 仍不裸露
  })
})

const NEW_CHAPTER: ChapterOutlineData = {
  chapter: 4,
  title: '藏经阁对质',
  positioning: '第一卷张力峰值章，玉佩伏笔本章揭示。',
  beats: [
    '入场压力：沈砚借还经书进阁，陆昭已在。',
    '升级：拍出玉佩追问那夜下落。',
    '翻转：说出内圈刻痕，陆昭神色裂开。',
  ],
  must_deliver: ['玉佩来历靠物证呈现不靠旁白'],
  payoff_beat: 'reveal',
  storyline_focus: ['SL-revenge'],
  storylineNames: { 'SL-revenge': '复仇线' },
  characters: [{ character_uid: '00000000-0000-4000-8000-000000000001', name: '沈砚' }],
  pov_character: { character_uid: '00000000-0000-4000-8000-000000000001', name: '沈砚' },
  foreshadowing_touch: [{ id: 'F01', action: 'reveal' }],
  foreshadowingDescriptions: { F01: '玉佩' },
}

describe('renderChapterOutlineMarkdown（beat 骨架新格式）', () => {
  test('渲染 beat 骨架结构 + 用户向风格（隐藏机器 id / 英文枚举）', () => {
    const md = renderChapterOutlineMarkdown(NEW_CHAPTER)
    expect(md.split('\n')[0]).toBe('# 第 4 章：藏经阁对质')
    expect(md).toContain('## 本章定位')
    expect(md).toContain('第一卷张力峰值章，玉佩伏笔本章揭示。')
    expect(md).toContain('## 场景骨架')
    expect(md).toContain('1. 入场压力：沈砚借还经书进阁，陆昭已在。')
    expect(md).toContain('3. 翻转：说出内圈刻痕，陆昭神色裂开。')
    expect(md).toContain('## 必须落地')
    expect(md).toContain('- 玉佩来历靠物证呈现不靠旁白')
    expect(md).toContain('**本章爽点**：反转') // getPayoffBeatLabel(reveal) = 反转（App 用户向标签）
    expect(md).not.toContain('强度') // NEW_CHAPTER 未填 payoff_intensity
    expect(md).toContain('**聚焦故事线**：复仇线')
    expect(md).toContain('**视角人物**：沈砚')
    expect(md).toContain('**出场角色**：沈砚')
    // 用户向：机器 id 与英文枚举后缀不裸露
    expect(md).not.toContain('SL-revenge')
    expect(md).not.toContain('（reveal）')
  })

  test('新格式 payoff_intensity 有值时附加强度标签（issue #429）', () => {
    const md = renderChapterOutlineMarkdown({ ...NEW_CHAPTER, payoff_intensity: 'medium' })
    expect(md).toContain('**本章爽点**：反转 · 强度：中')
  })

  test('新格式伏笔动作显「动作：描述」，复用书级 registry，id 不裸露', () => {
    const md = renderChapterOutlineMarkdown(NEW_CHAPTER)
    expect(md).toContain('## 伏笔动作')
    expect(md).toContain('- 揭示：玉佩')
    expect(md).not.toContain('F01')
  })

  test('isNewFormatChapterOutline 按 beats 数组判别新旧格式', () => {
    expect(isNewFormatChapterOutline({ beats: ['a', 'b', 'c'] })).toBe(true)
    expect(isNewFormatChapterOutline({ value_shift: 'x' })).toBe(false)
    expect(isNewFormatChapterOutline(CHAPTER)).toBe(false)
  })
})

describe('renderOutlineVolumesMarkdown', () => {
  test('只渲染卷章结构段，且与整体渲染中的对应段一致', () => {
    const data = {
      central_dramatic_question: '问题',
      volumes: [
        {
          volume_no: 1,
          title: '第一卷',
          arc_list: [{ arc_id: 'V01-A01', title: '开局', chapter_start: 1, chapter_end: 10 }],
        },
      ],
    }
    const volumesOnly = renderOutlineVolumesMarkdown(data)
    expect(volumesOnly).toContain('## 卷章结构')
    expect(volumesOnly).toContain('第一卷')
    expect(volumesOnly).not.toContain('中心戏剧问题')
    // 整体渲染包含同一段（拆分是纯搬移，不改变输出）
    expect(renderOutlineStructureMarkdown(data)).toContain(volumesOnly.trim())
    // 无卷返回空串
    expect(renderOutlineVolumesMarkdown({ central_dramatic_question: '问题' })).toBe('')
  })
})

describe('renderChapterOutlineMarkdown（本章状态变更节，P1-3）', () => {
  test('渲染「## 本章状态变更」节（新旧格式共用；维度显示名优先，缺映射回退 key）', () => {
    const md = renderChapterOutlineMarkdown({
      chapter: 5,
      title: '试炼',
      positioning: '推进',
      beats: ['b1'],
      state_changes: [
        { character: { name: '林晚' }, dimension: 'cultivation_level', operation: 'set', value: '筑基', reason: '突破' },
        { character: { name: '林晚' }, dimension: 'inventory', operation: 'add', value: '短刀' },
      ],
      stateDimensionNames: { cultivation_level: '境界' },
    })
    expect(md).toContain('## 本章状态变更')
    expect(md).toContain('- 林晚：境界 变为「筑基」（突破）')
    expect(md).toContain('- 林晚：inventory 获得「短刀」')
  })
})
