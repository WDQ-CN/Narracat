import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, test } from 'bun:test'

/**
 * 墓碑测试：防「硬编码情绪方向词」回归 + 防「候选模式退役后死灰复燃」回归。
 *
 * 病型（PR #435 评审实锤）：电压点候选「再讲一遍」指令曾在 write.md 派发文案与
 * chapter-writer.md 常驻 prompt 各写了一份，其中的方向性暗示词（「更狠、更冷、
 * 更直给」）只在派发文案里修成了声音中立，常驻那份漏改——甜宠/温暖/轻松向章节
 * 的候补版会继续被常驻 prompt 带跑调。
 *
 * 现状（一热一冷重构，2026-07-29）：电压点多版判优 / best-of-N 候选机制已从
 * chapter-writer.md 与 write.md 两处一并撤下（写手常驻 prompt 只剩热写/冷改两
 * 态；write.md 的审校后流程改为冷 pass 单遍打磨，不再分电压点）。
 *
 * 纪律：候选段的方向永远由 persona / style_directive 决定，创作邀请只点火不指路；
 * 任何硬编码情绪方向词重回这两个文件（无论哪一份）时本测试失败——这条黑名单检查
 * 与候选模式是否存在无关，作为通用回归闸继续保留。
 */

const agentCoreRoot = join(import.meta.dir, '..')

/** 硬编码情绪方向词黑名单：评审实锤三词 + 同型近亲（当前两文件均不合法使用） */
const BANNED_TONE_DIRECTIONS = ['更狠', '更冷', '更直给', '更燃', '更虐', '更黑暗', '更热血']

const VOLTAGE_PROMPT_FILES = [
  join(agentCoreRoot, 'agents', 'chapter-writer.md'),
  join(agentCoreRoot, 'commands', 'write.md'),
]

describe('派发指令声音中立（chapter-writer.md 常驻 + write.md 派发两份都守）', () => {
  for (const file of VOLTAGE_PROMPT_FILES) {
    test(`${basename(file)} 不含硬编码情绪方向词`, () => {
      const content = readFileSync(file, 'utf-8')
      for (const word of BANNED_TONE_DIRECTIONS) {
        expect(content).not.toContain(word)
      }
    })
  }

  test('chapter-writer.md 电压点候选模式小节已随一热一冷重构撤下（写手常驻 prompt 只剩热写/冷改两态，候选模式不再是其职责）', () => {
    const content = readFileSync(join(agentCoreRoot, 'agents', 'chapter-writer.md'), 'utf-8')
    expect(content).not.toContain('## 电压点候选模式')
  })

  test('write.md 电压点多版判优小节已随一热一冷重构撤下（判优/候选逻辑不再是 write.md 的职责）', () => {
    const content = readFileSync(join(agentCoreRoot, 'commands', 'write.md'), 'utf-8')
    expect(content).not.toContain('### 电压点多版判优')
  })
})
