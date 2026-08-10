import { describe, expect, test } from 'bun:test'
import {
  checkChapterWordcount,
  createBriefLintState,
  judgeChapterWriterOutput,
  judgeMemoryKeeperReceipt,
  lintBriefForSystemWords,
} from './engine-hooks'

// 钩子判据的唯一测试面：前身 shell 钩子（check-chapter-wordcount.sh / check-brief-lint.sh）
// 及其 .test.mjs 已随 claude-sdk 退役删除，其用例语义已并入本文件。

describe('checkChapterWordcount', () => {
  test('非章节路径 → undefined（bible/premise.md）', () => {
    expect(
      checkChapterWordcount({ filePath: 'bible/premise.md', content: 'x'.repeat(5000) })
    ).toBeUndefined()
  })

  test('非章节路径 → undefined（.narracat/staging/ch-001.brief.md）', () => {
    expect(
      checkChapterWordcount({
        filePath: '.narracat/staging/ch-001.brief.md',
        content: 'x'.repeat(5000),
      })
    ).toBeUndefined()
  })

  test('manuscript/ch-1.md 命中路径正则', () => {
    const result = checkChapterWordcount({ filePath: 'manuscript/ch-1.md', content: '字'.repeat(1799) })
    expect(result).toContain('低于目标区间下限 1800')
  })

  test('manuscript/vol-01/ch-001.md 命中路径正则', () => {
    const result = checkChapterWordcount({
      filePath: 'manuscript/vol-01/ch-001.md',
      content: '字'.repeat(1799),
    })
    expect(result).toContain('低于目标区间下限 1800')
  })

  test('1799 个非空白字符 → 含低于目标区间下限 1800', () => {
    const result = checkChapterWordcount({ filePath: 'manuscript/ch-1.md', content: '字'.repeat(1799) })
    expect(result).toBe('章节字数 1799 低于目标区间下限 1800（manuscript/ch-1.md）。可能需要补写。')
  })

  test('4001 个非空白字符 → 含高于目标区间上限 4000', () => {
    const result = checkChapterWordcount({ filePath: 'manuscript/ch-1.md', content: '字'.repeat(4001) })
    expect(result).toBe('章节字数 4001 高于目标区间上限 4000（manuscript/ch-1.md）。可能需要精简。')
  })

  test('区间内 → undefined', () => {
    expect(
      checkChapterWordcount({ filePath: 'manuscript/ch-1.md', content: '字'.repeat(2500) })
    ).toBeUndefined()
  })

  test('1800（下限本身）→ undefined', () => {
    expect(
      checkChapterWordcount({ filePath: 'manuscript/ch-1.md', content: '字'.repeat(1800) })
    ).toBeUndefined()
  })

  test('4000（上限本身）→ undefined', () => {
    expect(
      checkChapterWordcount({ filePath: 'manuscript/ch-1.md', content: '字'.repeat(4000) })
    ).toBeUndefined()
  })

  test('wordsPerChapter: 3000 → 下限 2100', () => {
    const result = checkChapterWordcount({
      filePath: 'manuscript/ch-1.md',
      content: '字'.repeat(2099),
      wordsPerChapter: 3000,
    })
    expect(result).toBe('章节字数 2099 低于目标区间下限 2100（manuscript/ch-1.md）。可能需要补写。')
  })

  test('wordsPerChapter: 3000 → 上限 4500', () => {
    const result = checkChapterWordcount({
      filePath: 'manuscript/ch-1.md',
      content: '字'.repeat(4501),
      wordsPerChapter: 3000,
    })
    expect(result).toBe('章节字数 4501 高于目标区间上限 4500（manuscript/ch-1.md）。可能需要精简。')
  })

  test('空白不计数：全角空格 U+3000 与换行不算字数', () => {
    const content = '字'.repeat(1800) + '　　'.repeat(500) + '\n\n\n'
    expect(checkChapterWordcount({ filePath: 'manuscript/ch-1.md', content })).toBeUndefined()
  })
})

describe('lintBriefForSystemWords', () => {
  const STAGING_PATH = '.narracat/staging/ch-004.brief.md'
  const NOW = 1_000_000_000

  test('非 staging 路径 → clean', () => {
    const state = createBriefLintState()
    const result = lintBriefForSystemWords({
      filePath: 'manuscript/vol-01/ch-004.md',
      content: '本章要处理 heartbeat_moment。',
      state,
      now: NOW,
    })
    expect(result).toEqual({ verdict: 'clean' })
  })

  test('命中 novel_commit_chapter → block，feedback 含系统词提示与行号格式命中；state 记录时间戳', () => {
    const state = createBriefLintState()
    const result = lintBriefForSystemWords({
      filePath: STAGING_PATH,
      content: '第一行干净。\n本章要调用 novel_commit_chapter 提交。',
      state,
      now: NOW,
    })
    expect(result.verdict).toBe('block')
    if (result.verdict === 'block') {
      expect(result.feedback).toContain('任务书里出现了系统词')
      expect(result.feedback).toContain('2:本章要调用 novel_commit_chapter 提交。')
    }
    expect(state.warnedAt.get(STAGING_PATH)).toBe(NOW)
  })

  test('前 10 条命中：第 11 条不出现在 feedback 中', () => {
    const state = createBriefLintState()
    const lines = Array.from({ length: 12 }, (_, i) => `第 ${i + 1} 行 novel_commit_chapter`)
    const result = lintBriefForSystemWords({
      filePath: STAGING_PATH,
      content: lines.join('\n'),
      state,
      now: NOW,
    })
    expect(result.verdict).toBe('block')
    if (result.verdict === 'block') {
      expect(result.feedback).toContain('1:第 1 行 novel_commit_chapter')
      expect(result.feedback).toContain('10:第 10 行 novel_commit_chapter')
      expect(result.feedback).not.toContain('11:第 11 行 novel_commit_chapter')
      expect(result.feedback).not.toContain('12:第 12 行 novel_commit_chapter')
    }
  })

  test('同路径 5 分钟内二次命中 → warn_pass，feedback 含已放行提示；state 中该路径被清除', () => {
    const state = createBriefLintState()
    const first = lintBriefForSystemWords({
      filePath: STAGING_PATH,
      content: '本章要处理 heartbeat_moment。',
      state,
      now: NOW,
    })
    expect(first.verdict).toBe('block')

    const second = lintBriefForSystemWords({
      filePath: STAGING_PATH,
      content: '本章要处理 heartbeat_moment。',
      state,
      now: NOW + 60_000,
    })
    expect(second.verdict).toBe('warn_pass')
    if (second.verdict === 'warn_pass') {
      expect(second.feedback).toContain('已放行，请在完成输出附警示')
    }
    expect(state.warnedAt.has(STAGING_PATH)).toBe(false)
  })

  test('同路径超 5 分钟（now+301_000）再命中 → 重新 block（跨轮残留按首次拦截）', () => {
    const state = createBriefLintState()
    const first = lintBriefForSystemWords({
      filePath: STAGING_PATH,
      content: '本章要处理 heartbeat_moment。',
      state,
      now: NOW,
    })
    expect(first.verdict).toBe('block')

    const second = lintBriefForSystemWords({
      filePath: STAGING_PATH,
      content: '本章要处理 heartbeat_moment。',
      state,
      now: NOW + 301_000,
    })
    expect(second.verdict).toBe('block')
    expect(state.warnedAt.get(STAGING_PATH)).toBe(NOW + 301_000)
  })

  test('命中后修干净 → clean 且 state 清除', () => {
    const state = createBriefLintState()
    const first = lintBriefForSystemWords({
      filePath: STAGING_PATH,
      content: '本章要处理 heartbeat_moment。',
      state,
      now: NOW,
    })
    expect(first.verdict).toBe('block')

    const second = lintBriefForSystemWords({
      filePath: STAGING_PATH,
      content: '这一章沈砚独自回到旧宅，翻看了母亲留下的信件。',
      state,
      now: NOW + 1000,
    })
    expect(second).toEqual({ verdict: 'clean' })
    expect(state.warnedAt.has(STAGING_PATH)).toBe(false)
  })

  test('干净中文内容 → clean、state 无记录', () => {
    const state = createBriefLintState()
    const result = lintBriefForSystemWords({
      filePath: STAGING_PATH,
      content: '这一章沈砚独自回到旧宅，翻看了母亲留下的信件。',
      state,
      now: NOW,
    })
    expect(result).toEqual({ verdict: 'clean' })
    expect(state.warnedAt.has(STAGING_PATH)).toBe(false)
  })

  test('命中 \\b(canon|tentative|open)\\b（确定度枚举）', () => {
    const state = createBriefLintState()
    const result = lintBriefForSystemWords({
      filePath: STAGING_PATH,
      content: '这条伏笔状态是 tentative，暂不兑现。',
      state,
      now: NOW,
    })
    expect(result.verdict).toBe('block')
  })

  test('canonical 不命中（词内非整词边界）', () => {
    const state = createBriefLintState()
    const result = lintBriefForSystemWords({
      filePath: STAGING_PATH,
      content: '这是 canonical 设定，无需改动。',
      state,
      now: NOW,
    })
    expect(result).toEqual({ verdict: 'clean' })
  })

  test('命中伏笔编号形如 X-ABC-1', () => {
    const state = createBriefLintState()
    const result = lintBriefForSystemWords({
      filePath: STAGING_PATH,
      content: '记得埋下伏笔 X-ABC-1，后续兑现。',
      state,
      now: NOW,
    })
    expect(result.verdict).toBe('block')
  })

  test('命中 craft_pack_hints', () => {
    const state = createBriefLintState()
    const result = lintBriefForSystemWords({
      filePath: STAGING_PATH,
      content: '本章参考 craft_pack_hints 里的范例。',
      state,
      now: NOW,
    })
    expect(result.verdict).toBe('block')
  })

  test('now 缺省时使用 Date.now()', () => {
    const state = createBriefLintState()
    const before = Date.now()
    const result = lintBriefForSystemWords({
      filePath: STAGING_PATH,
      content: '本章要调用 novel_commit_chapter。',
      state,
    })
    const after = Date.now()
    expect(result.verdict).toBe('block')
    const recorded = state.warnedAt.get(STAGING_PATH)
    expect(recorded).toBeGreaterThanOrEqual(before)
    expect(recorded).toBeLessThanOrEqual(after)
  })
})

// 同上：前身 check-chapter-writer-output.sh（含内嵌 python 段）与 check-memory-keeper-receipt.sh
// 及其 .test.mjs 已删除，用例语义并入以下两组。

const DUOREN_OUTLINE = '两人对峙。沈砚和陆昭同处，关键冲突来自质问与试探。'
const DUOREN_CARDS = [{ name: '沈砚' }, { name: '陆昭' }]

describe('judgeChapterWriterOutput', () => {
  test('文件缺失 → 「正文文件未找到…需要重新生成」', () => {
    const result = judgeChapterWriterOutput({ chapter: 3 })
    expect(result).toEqual([
      '第 3 章正文文件未找到（期望路径 manuscript/vol-VV/ch-003.md）。需要重新生成本章正文。',
    ])
  })

  test('内容为空 → 「正文文件为空…需要重新生成」', () => {
    const result = judgeChapterWriterOutput({
      chapter: 3,
      manuscriptPath: 'manuscript/vol-01/ch-003.md',
      manuscriptText: '   \n\n  ',
    })
    expect(result).toEqual(['第 3 章正文文件为空（manuscript/vol-01/ch-003.md）。需要重新生成本章正文。'])
  })

  test('字数低于 wordsPerChapter*7/10 → 低于下限提示', () => {
    const result = judgeChapterWriterOutput({
      chapter: 1,
      manuscriptPath: 'manuscript/vol-01/ch-001.md',
      manuscriptText: '字'.repeat(2099),
      wordsPerChapter: 3000,
    })
    expect(result).toContain('第 1 章字数 2099 低于目标区间下限 2100（manuscript/vol-01/ch-001.md）。需要补写到目标区间。')
  })

  test('字数高于 wordsPerChapter*3/2 → 精简提示', () => {
    const result = judgeChapterWriterOutput({
      chapter: 1,
      manuscriptPath: 'manuscript/vol-01/ch-001.md',
      manuscriptText: '字'.repeat(4501),
      wordsPerChapter: 3000,
    })
    expect(result).toContain('第 1 章字数 4501 高于目标区间上限 4500（manuscript/vol-01/ch-001.md）。可适当精简。')
  })

  test('缺省 wordsPerChapter 时区间为 1800-4000', () => {
    const low = judgeChapterWriterOutput({
      chapter: 1,
      manuscriptPath: 'manuscript/vol-01/ch-001.md',
      manuscriptText: '字'.repeat(1799),
    })
    expect(low).toContain('第 1 章字数 1799 低于目标区间下限 1800（manuscript/vol-01/ch-001.md）。需要补写到目标区间。')

    const high = judgeChapterWriterOutput({
      chapter: 1,
      manuscriptPath: 'manuscript/vol-01/ch-001.md',
      manuscriptText: '字'.repeat(4001),
    })
    expect(high).toContain('第 1 章字数 4001 高于目标区间上限 4000（manuscript/vol-01/ch-001.md）。可适当精简。')
  })

  test('中文双引号左右不成对 → 提示（左 N / 右 M）', () => {
    const result = judgeChapterWriterOutput({
      chapter: 1,
      manuscriptPath: 'manuscript/vol-01/ch-001.md',
      manuscriptText: '第一章 雨夜\n\n“别动。\n\n她没有动。',
    })
    expect(result.some((m) => m.includes('中文双引号不成对（左 1 / 右 0）'))).toBe(true)
  })

  test('方角引号「」内含中文 → 对白引号提示', () => {
    const result = judgeChapterWriterOutput({
      chapter: 1,
      manuscriptPath: 'manuscript/vol-01/ch-001.md',
      manuscriptText: '第一章 雨夜\n\n「别动。」他说。\n\n她没有动。',
    })
    expect(result.some((m) => m.includes('方角引号'))).toBe(true)
  })

  test('方角引号纯符号装饰不提示', () => {
    const result = judgeChapterWriterOutput({
      chapter: 1,
      manuscriptPath: 'manuscript/vol-01/ch-001.md',
      manuscriptText: '第一章「Chapter One」标题装饰，正文照常继续下去。',
    })
    expect(result.some((m) => m.includes('方角引号'))).toBe(false)
  })

  test('ASCII 引号包裹中文 → 提示', () => {
    const result = judgeChapterWriterOutput({
      chapter: 1,
      manuscriptPath: 'manuscript/vol-01/ch-001.md',
      manuscriptText: '第一章 雨夜\n\n"别动。"他说。\n\n她没有动。',
    })
    expect(result.some((m) => m.includes('ASCII 引号'))).toBe(true)
  })

  test('ASCII 引号包裹英文串不提示', () => {
    const result = judgeChapterWriterOutput({
      chapter: 1,
      manuscriptPath: 'manuscript/vol-01/ch-001.md',
      manuscriptText: '门口挂着一块牌子，上面写着 "Welcome Home"。他盯着屏幕上跳出的 "ok" 看了很久。',
    })
    expect(result.some((m) => m.includes('ASCII 引号'))).toBe(false)
  })

  test('多人章对白占比 <0.12 → 对白偏少诊断', () => {
    const result = judgeChapterWriterOutput({
      chapter: 1,
      manuscriptPath: 'manuscript/vol-01/ch-001.md',
      manuscriptText:
        '第一章 雨夜\n\n沈砚进了藏经阁。陆昭站在窗边，手里压着经卷。两个人隔着一张案，谁都没有先开口。案上的玉佩被灯火照出一道旧痕，屋外巡夜的脚步声一下一下压过来。',
      contextPackJson: JSON.stringify({ chapter_outline: DUOREN_OUTLINE, character_cards: DUOREN_CARDS }),
    })
    expect(result.some((m) => m.includes('现场对白偏少'))).toBe(true)
  })

  test('章纲含低对话词（独处/战斗/回忆…）→ 不提示对白偏少', () => {
    const result = judgeChapterWriterOutput({
      chapter: 1,
      manuscriptPath: 'manuscript/vol-01/ch-001.md',
      manuscriptText:
        '第一章 旧物\n\n沈砚一个人在丹房里清点遗物。药柜的铜环凉得发硬，旧册页边缘被火燎过，翻开时落下一点灰。他站了很久，把那支银簪重新放回盒底。',
      contextPackJson: JSON.stringify({
        chapter_outline: '独处，低张力，情绪消化章。对话占比应很低，靠动作和环境负重。',
        character_cards: [{ name: '沈砚' }],
      }),
    })
    expect(result.some((m) => m.includes('现场对白偏少'))).toBe(false)
  })

  test('contextPackJson 损坏 JSON → 静默跳过占比诊断，其余判据照常', () => {
    const result = judgeChapterWriterOutput({
      chapter: 1,
      manuscriptPath: 'manuscript/vol-01/ch-001.md',
      manuscriptText: '第一章 雨夜\n\n“别动。\n\n她没有动。',
      contextPackJson: '{ 不是合法 JSON',
    })
    // 占比诊断被跳过（无 outline/character_cards 数据 → 不构成多人章，不触发）
    expect(result.some((m) => m.includes('现场对白偏少'))).toBe(false)
    // 其余判据（引号不成对）照常生效
    expect(result.some((m) => m.includes('中文双引号不成对'))).toBe(true)
  })
})

describe('judgeMemoryKeeperReceipt', () => {
  test('receiptText 缺省 → 「入库回执未找到…需要 memory-keeper 重新提交本章数据」', () => {
    const result = judgeMemoryKeeperReceipt({ chapter: 5 })
    expect(result).toEqual([
      '第 5 章入库回执未找到（.narracat/receipts/ch-005.json）。本章入库未完成，需要 memory-keeper 重新提交本章数据。',
    ])
  })

  test('receiptText 空白 → 同上提示', () => {
    const result = judgeMemoryKeeperReceipt({ chapter: 5, receiptText: '   \n' })
    expect(result).toEqual([
      '第 5 章入库回执未找到（.narracat/receipts/ch-005.json）。本章入库未完成，需要 memory-keeper 重新提交本章数据。',
    ])
  })

  test('receiptText 非空 → []', () => {
    const result = judgeMemoryKeeperReceipt({ chapter: 5, receiptText: '{"chapter":5}' })
    expect(result).toEqual([])
  })
})
