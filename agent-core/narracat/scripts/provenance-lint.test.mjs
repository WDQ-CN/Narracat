import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { lintProvenance } from './provenance-lint.mjs'

function fixture(agentsBody) {
  const root = mkdtempSync(join(tmpdir(), 'provenance-'))
  mkdirSync(join(root, 'agents'), { recursive: true })
  writeFileSync(join(root, 'agents', 'demo.md'), agentsBody, 'utf-8')
  return root
}

function scan(root) {
  return lintProvenance([{ dir: join(root, 'agents'), recursive: false }], root)
}

test('刀N 里程碑码：命中「刀4」', () => {
  const root = fixture('这是刀4 引入的规则。\n')
  const findings = scan(root)
  rmSync(root, { recursive: true, force: true })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].rule, '里程碑 刀N')
  assert.equal(findings[0].match, '刀4')
})

test('刀N 里程碑码：命中双位数「刀12」', () => {
  const root = fixture('刀12 收官后新增此段。\n')
  const findings = scan(root)
  rmSync(root, { recursive: true, force: true })
  assert.equal(findings.length, 1)
  assert.equal(findings[0].match, '刀12')
})

test('刀N 里程碑码：不误伤「一刀切」', () => {
  const root = fixture('禁止对所有题材一刀切地套用同一节奏表。\n')
  const findings = scan(root)
  rmSync(root, { recursive: true, force: true })
  assert.equal(findings.length, 0)
})

test('刀N 里程碑码：不误伤「刀光」等正常中文词（刀后不紧跟数字）', () => {
  const root = fixture('刀光剑影里，他握紧了刀柄，刀锋映着火光。\n')
  const findings = scan(root)
  rmSync(root, { recursive: true, force: true })
  assert.equal(findings.length, 0)
})

test('ignore 标记对 刀N 规则同样生效', () => {
  const root = fixture('<!-- drift-lint-ignore-next-line -->\n历史说明：刀4 阶段曾如此设计。\n')
  const findings = scan(root)
  rmSync(root, { recursive: true, force: true })
  assert.equal(findings.length, 0)
})

test('既有规则不受影响：仍命中 issue 号 / ADR / Goal / B 小数 / dogfood', () => {
  const root = fixture(
    ['issue #227 引入。', 'ADR-0016 决定如此。', 'Goal B B5.1 阶段目标。', 'B4.1 里程碑。', 'dogfood 验收后固化。'].join(
      '\n',
    ),
  )
  const findings = scan(root)
  rmSync(root, { recursive: true, force: true })
  const rules = findings.map((f) => f.rule)
  assert.ok(rules.includes('issue 号'))
  assert.ok(rules.includes('ADR 引用'))
  assert.ok(rules.includes('里程碑 Goal'))
  assert.ok(rules.includes('里程碑 B 小数'))
  assert.ok(rules.includes('dogfood 标记'))
})

test('真实运行时 prompt（agents/skills/commands）零命中', () => {
  const repoRoot = join(import.meta.dirname, '..')
  const findings = lintProvenance(
    [
      { dir: join(repoRoot, 'agents'), recursive: false },
      { dir: join(repoRoot, 'skills'), recursive: true },
      { dir: join(repoRoot, 'commands'), recursive: false },
    ],
    repoRoot,
  )
  assert.deepEqual(findings, [])
})
