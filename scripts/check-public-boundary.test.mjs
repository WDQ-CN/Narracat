// 公开仓防泄漏守卫：私有资产不得被 git 追踪，个人标识不得入库。
// 旧私有仓（license=UNLICENSED）自动跳过；新公开仓（AGPL-3.0-only）强制生效。
import { test, expect } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const license = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).license
const isPublicRepo = license === 'AGPL-3.0-only'

const FORBIDDEN_TRACKED_PREFIXES = [
  'agent-core/narracat/skills/novel-style-reference/references/corpus/',
  'agent-core/narracat/eval/', 'agent-core/narracat/docs/',
  'agent-core/narracat/CLAUDE.md', 'agent-core/narracat/CONTEXT.md', 'agent-core/narracat/CHANGELOG.md',
  'CLAUDE.md', 'AGENTS.md', 'CONTEXT.md', 'docs/COMPASS.md',
  '.claude/', '.agents/', '.superpowers/', 'poc/',
  'docs/adr/', 'docs/agents/', 'docs/superpowers/', 'docs/plans/', 'docs/report/', 'docs/research/',
  'scripts/corpus-factory/',
]
// 允许 pantsbang-yannik；禁其余个人标识
const FORBIDDEN_CONTENT = ['/Users/yannik', 'yangnik528', 'yannikzhang528', '张子扬']

const tracked = () => execFileSync('git', ['-C', repoRoot, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean)

test(isPublicRepo ? '私有资产路径不被 git 追踪' : '(skip)', () => {
  if (!isPublicRepo) return
  const bad = tracked().filter((f) =>
    FORBIDDEN_TRACKED_PREFIXES.some((p) => (p.endsWith('/') ? f.startsWith(p) : f === p)))
  expect(bad).toEqual([])
})

test(isPublicRepo ? '追踪文件内容不含个人标识' : '(skip)', () => {
  if (!isPublicRepo) return
  const hits = []
  for (const f of tracked()) {
    // 跳过守卫自身（包含禁用串作为数据常量，导致自指）
    if (f === 'scripts/check-public-boundary.test.mjs') continue
    let text
    try { text = readFileSync(join(repoRoot, f), 'utf8') } catch { continue }
    for (const needle of FORBIDDEN_CONTENT) if (text.includes(needle)) hits.push(`${f}: ${needle}`)
  }
  expect(hits).toEqual([])
})

test(!isPublicRepo ? '私有仓：守卫按设计跳过' : '(skip)', () => {
  if (isPublicRepo) return
  expect(license).toBe('UNLICENSED')
})
