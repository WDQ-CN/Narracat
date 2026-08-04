import { describe, expect, test } from 'bun:test'

import { buildCharacterChatSystemPrompt, buildCharacterChatUserPrompt } from './character-chat-prompt'

describe('buildCharacterChatSystemPrompt', () => {
  test('锁定角色身份、设定、知识边界与 UID 补查能力', () => {
    const prompt = buildCharacterChatSystemPrompt({
      name: '林衍',
      characterUid: 'uid-lin',
      settingContent: '# 林衍\n冷峻的剑客，重情义。',
      knowledgeBoundaryChapter: 12,
    })

    expect(prompt).toContain('扮演小说角色「林衍」')
    expect(prompt).toContain('冷峻的剑客')
    expect(prompt).toContain('第 12 章')
    // UID 补查指令携带 character_uid
    expect(prompt).toContain('uid-lin')
    // 工具感知措辞：拥有只读工具，但不外露调用/检索过程
    expect(prompt).toContain('只读工具')
    expect(prompt).toContain('不要把工具调用')
    // 空结果/想不起时不外露、不说机械词（修走查泄露「查不到数据」）
    expect(prompt).toContain('凭记忆在说话')
    expect(prompt).toContain('没有结果')
    // 不剧透未来
    expect(prompt).toContain('绝不提及')
    // 纯聊天，不写正文/不入正史
    expect(prompt).toContain('不要写小说正文')
    expect(prompt).toContain('正史')
  })

  test('含说话方式硬规则：禁括号旁白、空行分条、语言指纹、few-shot 示范', () => {
    const prompt = buildCharacterChatSystemPrompt({
      name: '林衍',
      characterUid: 'uid-lin',
      settingContent: '冷峻寡言的剑客。',
      knowledgeBoundaryChapter: 3,
    })
    expect(prompt).toContain('绝不用括号')
    expect(prompt).toContain('空一行')
    expect(prompt).toContain('语言指纹')
    expect(prompt).toContain('说话方式示范')
  })

  test('无完成章节时说明角色对剧情几乎一无所知', () => {
    const prompt = buildCharacterChatSystemPrompt({
      name: '苏暮',
      characterUid: 'uid-su',
      settingContent: '',
      knowledgeBoundaryChapter: null,
    })
    expect(prompt).toContain('尚无已完成章节')
    expect(prompt).toContain('暂为空')
  })
})

describe('buildCharacterChatSystemPrompt 处境包（片4）', () => {
  test('处境包注入：内容+一致性要求+冲突以处境为准；空处境包不注入', () => {
    const prompt = buildCharacterChatSystemPrompt({
      name: '苏见',
      characterUid: 'uid-su',
      settingContent: '# 苏见',
      knowledgeBoundaryChapter: 11,
      situationPack: '【你当前的处境】（截至第 11 章）\n你的关系：\n· 阿九：同行伙伴（第6章）',
    })
    expect(prompt).toContain('【你当前的处境】')
    expect(prompt).toContain('· 阿九：')
    expect(prompt).toContain('以这里为准') // 冲突声明
    expect(prompt).toContain('必须记得') // 一致性要求

    const bare = buildCharacterChatSystemPrompt({
      name: '苏见',
      characterUid: 'uid-su',
      settingContent: '',
      knowledgeBoundaryChapter: 11,
    })
    expect(bare).not.toContain('以这里为准')
  })

  test('退路条款两层：处境包内必须一致，处境包外才允许带过', () => {
    const prompt = buildCharacterChatSystemPrompt({
      name: '苏见',
      characterUid: 'uid-su',
      settingContent: '# 苏见',
      knowledgeBoundaryChapter: 11,
      situationPack: '【你当前的处境】（截至第 11 章）\n你的关系：\n· 阿九：同行伙伴（第6章）',
    })
    expect(prompt).toContain('处境之外')
    expect(prompt).toContain('先用工具查')
    expect(prompt).toContain('凭记忆在说话') // 不出戏纪律保留
    expect(prompt).not.toContain('或你一时想不起某个细节，就按你已知的设定') // 旧的无条件退路已删
  })
})

describe('buildCharacterChatUserPrompt', () => {
  test('裁剪用户消息空白', () => {
    expect(buildCharacterChatUserPrompt('  你好  ')).toBe('你好')
  })
})

describe('buildCharacterChatSystemPrompt 懂你段', () => {
  const base = {
    name: '苏见',
    characterUid: 'char_1',
    settingContent: '高冷剑客',
    knowledgeBoundaryChapter: 5 as number | null,
  }

  test('有画像时注入，且不点破作者身份', () => {
    const prompt = buildCharacterChatSystemPrompt({
      ...base,
      authorProfile: '爱追问细节',
      impression: '上次站阿九那边',
    })
    expect(prompt).toContain('爱追问细节')
    expect(prompt).toContain('上次站阿九那边')
    expect(prompt).not.toContain('作者')
  })

  test('画像为空时不加懂你段', () => {
    const prompt = buildCharacterChatSystemPrompt({ ...base })
    expect(prompt).not.toContain('关于和你聊天的这位')
  })

  test('只有 authorProfile 时含「你逐渐了解到 ta」但不含「你对 ta 的印象」', () => {
    const prompt = buildCharacterChatSystemPrompt({ ...base, authorProfile: '爱追问细节' })
    expect(prompt).toContain('你逐渐了解到 ta')
    expect(prompt).not.toContain('你对 ta 的印象')
  })
})

describe('buildCharacterChatSystemPrompt 时间锚点', () => {
  const base = {
    name: '苏见',
    characterUid: 'char_1',
    settingContent: '高冷剑客',
    knowledgeBoundaryChapter: 5,
  }

  test('距上次聊天超过阈值时加锚点', () => {
    const now = Date.parse('2026-06-24T10:00:00.000Z')
    const prompt = buildCharacterChatSystemPrompt({
      ...base,
      lastChatAt: '2026-06-21T10:00:00.000Z', // 3 天前
      nowMs: now,
    })
    expect(prompt).toContain('距你们上次聊天已过去')
    expect(prompt).toContain('3 天')
  })

  test('间隔小 / 无历史时不加锚点', () => {
    const now = Date.parse('2026-06-24T10:00:00.000Z')
    expect(
      buildCharacterChatSystemPrompt({ ...base, lastChatAt: '2026-06-24T09:00:00.000Z', nowMs: now }),
    ).not.toContain('距你们上次聊天已过去')
    expect(buildCharacterChatSystemPrompt({ ...base })).not.toContain('距你们上次聊天已过去')
  })
})
