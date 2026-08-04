// 文档时效性防回归守卫：已退役的 Claude Agent SDK / Claude Code plugin 底座措辞不得
// 再出现在追踪的 .md 文档或 package.json 的 description 字段里（现行底座 = pi agent
// runtime，见 CLAUDE.md / ARCHITECTURE.md）。
import { test, expect } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// 本文件自身的仓库相对路径（跳过自指：下面扫描把禁用短语当字符串数据引用，
// 若不跳过会命中自己的 FORBIDDEN_PHRASES 常量）
const SELF_PATH = 'scripts/check-doc-freshness.test.mjs'

const FORBIDDEN_PHRASES = [
  'Claude Agent SDK',
  'claude-agent-sdk',
  '@anthropic-ai/claude-code',
  '--plugin-dir',
  'Claude Code plugin',
  '.claude-plugin',
]

const tracked = (pattern) =>
  execFileSync('git', ['-C', repoRoot, 'ls-files', '--', pattern], { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)

const scanText = (file, text, hits) => {
  for (const phrase of FORBIDDEN_PHRASES) {
    if (text.includes(phrase)) hits.push(`${file}: ${phrase}`)
  }
}

test('追踪的 .md 文档不含已退役底座措辞', () => {
  const hits = []
  for (const f of tracked('*.md')) {
    if (f === SELF_PATH) continue
    let text
    try {
      text = readFileSync(join(repoRoot, f), 'utf8')
    } catch {
      continue
    }
    scanText(f, text, hits)
  }
  expect(hits).toEqual([])
})

test('package.json 的 description 字段不含已退役底座措辞', () => {
  const hits = []
  const candidates = new Set([...tracked('**/package.json'), ...tracked('package.json')])
  for (const f of candidates) {
    let pkg
    try {
      pkg = JSON.parse(readFileSync(join(repoRoot, f), 'utf8'))
    } catch {
      continue
    }
    if (typeof pkg.description === 'string') scanText(f, pkg.description, hits)
  }
  expect(hits).toEqual([])
})
