import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { lintStructurePacks } from './structure-pack-lint.mjs'

function fixture(packs, index) {
  const root = mkdtempSync(join(tmpdir(), 'sp-'))
  mkdirSync(join(root, 'packs'), { recursive: true })
  for (const [name, body] of Object.entries(packs)) writeFileSync(join(root, 'packs', name), body)
  writeFileSync(join(root, 'packs', 'pack-index.json'), JSON.stringify(index))
  return root
}
const goodPack = '# arc-rhythm\n## 机制\nx\n## 原则\n- a\n## 真人范例\n> A · 短范例\n## 适用\ny\n'
const goodIndex = { version: '1', packs: [{ id: 'arc-rhythm', path: '${CLAUDE_PLUGIN_ROOT}/skills/novel-structure/references/packs/arc-rhythm.md', dimension: 'D1', stage: 'stage-1', one_line: 'x' }] }

test('齐全的 pack 通过', () => {
  const r = lintStructurePacks(fixture({ 'arc-rhythm.md': goodPack }, goodIndex))
  assert.equal(r.ok, true)
})

test('缺机制卡四要素之一 → 报错', () => {
  const bad = '# arc-rhythm\n## 机制\nx\n## 原则\n- a\n## 适用\ny\n' // 缺「真人范例」
  const r = lintStructurePacks(fixture({ 'arc-rhythm.md': bad }, goodIndex))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('真人范例')))
})

test('index 引用的 pack 文件不存在 → 报错（双向一致）', () => {
  const idx = { version: '1', packs: [{ id: 'missing', path: '${CLAUDE_PLUGIN_ROOT}/skills/novel-structure/references/packs/missing.md', dimension: 'D9', stage: 'stage-1', one_line: 'x' }] }
  const r = lintStructurePacks(fixture({ 'arc-rhythm.md': goodPack }, idx))
  assert.equal(r.ok, false)
})

test('evidence 超 300 字 → 报错', () => {
  const long = '# arc-rhythm\n## 机制\nx\n## 原则\n- a\n## 真人范例\n> A · ' + '字'.repeat(320) + '\n## 适用\ny\n'
  const r = lintStructurePacks(fixture({ 'arc-rhythm.md': long }, goodIndex))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('300')))
})

test('path 缺 ${CLAUDE_PLUGIN_ROOT}/ 前缀 → 报错', () => {
  const idx = { version: '1', packs: [{ id: 'arc-rhythm', path: 'skills/novel-structure/references/packs/arc-rhythm.md', dimension: 'D1', stage: 'stage-1', one_line: 'x' }] }
  const r = lintStructurePacks(fixture({ 'arc-rhythm.md': goodPack }, idx))
  assert.equal(r.ok, false)
})

test('pack 缺/非法 stage → 报错', () => {
  const idx = { version: '1', packs: [{ id: 'arc-rhythm', path: '${CLAUDE_PLUGIN_ROOT}/skills/novel-structure/references/packs/arc-rhythm.md', dimension: 'D1', one_line: 'x' }] }
  const r = lintStructurePacks(fixture({ 'arc-rhythm.md': goodPack }, idx))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('stage')))
  // 报错文案须列全三个合法值（含 stage-opening），别让修复者误以为只有两档
  assert.ok(r.errors.some((e) => e.includes('stage-opening')))
})

test('顶层 always_on 已废弃 → 报错', () => {
  const idx = { always_on: true, packs: [{ id: 'arc-rhythm', path: '${CLAUDE_PLUGIN_ROOT}/skills/novel-structure/references/packs/arc-rhythm.md', dimension: 'D1', stage: 'stage-1', one_line: 'x' }] }
  const r = lintStructurePacks(fixture({ 'arc-rhythm.md': goodPack }, idx))
  assert.equal(r.ok, false)
  assert.ok(r.errors.some((e) => e.includes('always_on')))
})
