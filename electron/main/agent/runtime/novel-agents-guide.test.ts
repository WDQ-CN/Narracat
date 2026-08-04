/**
 * resolveNovelAgentsGuide 单测：AGENTS.md 优先 / CLAUDE.md 回退 / 都无返回 null / 32KB 截断护栏。
 * 单文件精准读取，不上溯祖先（ADR-0028 隔离纪律）——本文件只测 projectPath 根下的读取行为。
 */
import { describe, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveNovelAgentsGuide } from './novel-agents-guide.ts'

async function makeProjectDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'narracat-novel-agents-guide-'))
}

describe('resolveNovelAgentsGuide', () => {
  test('只有 AGENTS.md：返回其内容', async () => {
    const dir = await makeProjectDir()
    await writeFile(join(dir, 'AGENTS.md'), '# 本书写作说明\n')
    expect(await resolveNovelAgentsGuide(dir)).toBe('# 本书写作说明')
  })

  test('只有 CLAUDE.md：回退返回其内容', async () => {
    const dir = await makeProjectDir()
    await writeFile(join(dir, 'CLAUDE.md'), '# 存量书遗留说明\n')
    expect(await resolveNovelAgentsGuide(dir)).toBe('# 存量书遗留说明')
  })

  test('两者都有：AGENTS.md 优先', async () => {
    const dir = await makeProjectDir()
    await writeFile(join(dir, 'AGENTS.md'), 'agents 版本')
    await writeFile(join(dir, 'CLAUDE.md'), 'claude 版本')
    expect(await resolveNovelAgentsGuide(dir)).toBe('agents 版本')
  })

  test('都没有 / projectPath undefined / 目录不存在：返回 null', async () => {
    const dir = await makeProjectDir()
    expect(await resolveNovelAgentsGuide(dir)).toBeNull()
    expect(await resolveNovelAgentsGuide(undefined)).toBeNull()
    expect(await resolveNovelAgentsGuide(join(dir, 'not-a-real-subdir'))).toBeNull()
  })

  test('超 32KB：截断且结尾含「已截断」标注', async () => {
    const dir = await makeProjectDir()
    const oversized = 'A'.repeat(40 * 1024)
    await writeFile(join(dir, 'AGENTS.md'), oversized)
    const result = await resolveNovelAgentsGuide(dir)
    expect(result).not.toBeNull()
    expect(result!.length).toBeLessThan(oversized.length)
    expect(result).toContain('AGENTS.md 过长，已截断')
  })

  // 回退命中 CLAUDE.md 时截断标注须按实际命中文件名生成，不能硬编码写死 AGENTS.md
  // （否则存量书回退读 CLAUDE.md 截断后，标注仍会误报「AGENTS.md 过长」）。
  test('只有 CLAUDE.md 且超 32KB：截断标注按实际命中文件名（CLAUDE.md）生成', async () => {
    const dir = await makeProjectDir()
    const oversized = 'B'.repeat(40 * 1024)
    await writeFile(join(dir, 'CLAUDE.md'), oversized)
    const result = await resolveNovelAgentsGuide(dir)
    expect(result).not.toBeNull()
    expect(result).toContain('CLAUDE.md 过长，已截断')
    expect(result).not.toContain('AGENTS.md')
  })

  // 上一用例纯 ASCII（1 字节/字符），字节截断与字符截断产出完全相同、锁不住选定的字节语义。
  // 本用例用 3 字节/字符的中文构造总长恰好跨过 32768 字节边界的内容，专门锁定字节级
  // 截断（Buffer.subarray）特有行为：切点落在多字节字符中间、解码出一个 U+FFFD 替换符。
  // 若实现换成字符级 slice（如 brief 提到的 content.slice(0, 16000) 近似），10923 个字符
  // 总数远小于 16000，根本不会触发截断、会原样整串返回——与本用例末尾断言天然不自洽，
  // 能当场测出实现是否被换成字符级语义。
  test('超 32KB 且多字节字符恰好跨字节边界：字节级截断特有行为（切断处产出替换符）', async () => {
    const dir = await makeProjectDir()
    const oversized = '汉'.repeat(10923) // 32769 字节（3 字节/字符），32768 边界正好切在第 10923 个字符中间
    await writeFile(join(dir, 'AGENTS.md'), oversized)
    const result = await resolveNovelAgentsGuide(dir)
    expect(result).not.toBeNull()
    expect(result).toContain('已截断')

    const noticeIndex = result!.indexOf('\n（AGENTS.md 过长')
    const contentPart = result!.slice(0, noticeIndex)
    // 精确锁定：前 10922 个「汉」完整保留，第 10923 个字符被从字节中间切断，
    // 解码残留一个 U+FFFD 替换符收尾——这是 Buffer.subarray(0, 32768) 字节级截断的确定性产出，
    // 与字符级 slice（会保留全部 10923 个完整「汉」、不产生替换符）截然不同。
    expect(contentPart).toBe(`${'汉'.repeat(10922)}�`)
    expect(contentPart).not.toBe(oversized)
    // 已知边角：切断点解码出的 U+FFFD 重新编码回 UTF-8 是 3 字节，比原残留的 2 字节多 1 字节，
    // 导致内容部分字节数比 32768 上限多出 1 字节（32769）——受限、可预期的越界，非无界膨胀。
    expect(Buffer.byteLength(contentPart, 'utf8')).toBe(32 * 1024 + 1)
  })
})
