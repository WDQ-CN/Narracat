import { test, expect } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectViolations, parseAllowedRules, partitionViolations } from './check-architecture.mjs'

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'arch-'))
  for (const [rel, content] of Object.entries(files)) {
    mkdirSync(join(root, rel, '..'), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  return root
}

test('electron import src 实现是违规（含 import type 与动态 import）', () => {
  const root = fixture({
    'electron/main/a.ts': "import { x } from '../../src/lib/y'\n",
    'electron/main/b.ts': "import type { T } from '../../src/types/z'\n",
    'electron/main/c.ts': "const m = await import('../../src/lib/y')\n",
    'src/lib/y.ts': 'export const x = 1\n',
  })
  const rules = collectViolations(root).map((v) => v.rule)
  expect(rules.filter((r) => r === 'electron-to-src').length).toBe(3)
})

test('src import electron 是违规；@/ 别名解析到 src 不误伤 src 内部', () => {
  const root = fixture({
    'src/lib/a.ts': "import { x } from '../../electron/main/config'\nimport { y } from '@/lib/other'\n",
    'src/lib/other.ts': 'export const y = 1\n',
  })
  const v = collectViolations(root)
  expect(v.length).toBe(1)
  expect(v[0].rule).toBe('src-to-electron')
})

test('shared 不得 import electron 或 src（含 re-export 洗白）', () => {
  const root = fixture({
    'shared/lib/a.ts': "export * from '../../src/lib/y'\n",
    'src/lib/y.ts': 'export const x = 1\n',
  })
  expect(collectViolations(root)[0].rule).toBe('shared-to-app')
})

test('任何位置 import claude-agent-sdk 都是 retired-runtime（拆旧刀5：SDK 全链退役，adapters 内也不豁免）', () => {
  const root = fixture({
    'electron/main/foo.ts': "import { query } from '@anthropic-ai/claude-agent-sdk'\n",
    'electron/main/agent/runtime/adapters/claude-sdk/sdk-runner.ts':
      "import { query } from '@anthropic-ai/claude-agent-sdk'\n",
  })
  const v = collectViolations(root)
  expect(v.length).toBe(2)
  expect(v.every((x) => x.rule === 'retired-runtime')).toBe(true)
})

test('import type 引 claude-agent-sdk 也是 retired-runtime（全强度规则，类型引用同样算触碰退役包）', () => {
  const root = fixture({
    'electron/main/foo.ts': "import type { CanUseTool } from '@anthropic-ai/claude-agent-sdk'\n",
  })
  const v = collectViolations(root)
  expect(v.length).toBe(1)
  expect(v[0].rule).toBe('retired-runtime')
})

test('adapters 外 import pi 包也是 runtime-leak（阶段 2 切片①：pi 与 claude-agent-sdk 同规收口）', () => {
  const root = fixture({
    'electron/main/foo.ts': "import { createAgentSession } from '@mariozechner/pi-coding-agent'\n",
    'electron/main/bar.ts': "import type { Model } from '@mariozechner/pi-ai'\n",
    'electron/main/agent/runtime/adapters/pi/pi-session.ts':
      "import { createAgentSession } from '@mariozechner/pi-coding-agent'\n",
  })
  const v = collectViolations(root)
  expect(v.length).toBe(2)
  expect(v.every((x) => x.rule === 'runtime-leak')).toBe(true)
})

test('adapters 外 import @mariozechner 传递包（pi-agent-core/pi-tui）也是 runtime-leak（切片②前缀收口）', () => {
  const root = fixture({
    'electron/main/foo.ts': "import type { AgentEvent } from '@mariozechner/pi-agent-core'\n",
    'electron/main/agent/runtime/adapters/pi/x.ts': "import type { AgentEvent } from '@mariozechner/pi-agent-core'\n",
  })
  const v = collectViolations(root)
  expect(v.length).toBe(1)
  expect(v[0].rule).toBe('runtime-leak')
  expect(v[0].file).toContain('foo.ts')
})

test('parseAllowedRules 从 argv 解析 --allow 值（支持重复出现与逗号列表）', () => {
  expect(parseAllowedRules(['--enforce', '--allow', 'runtime-leak'])).toEqual(['runtime-leak'])
  expect(parseAllowedRules(['--allow', 'a,b', '--allow', 'c'])).toEqual(['a', 'b', 'c'])
  expect(parseAllowedRules(['--enforce'])).toEqual([])
})

test('partitionViolations: 被 --allow 豁免的规则违规仍打印(allowed=true)但不计入 enforceCount', () => {
  const root = fixture({
    'electron/main/foo.ts': "import { createAgentSession } from '@mariozechner/pi-coding-agent'\n",
    'electron/main/a.ts': "import { x } from '../../src/lib/y'\n",
    'src/lib/y.ts': 'export const x = 1\n',
  })
  const violations = collectViolations(root)
  const { annotated, enforceCount } = partitionViolations(violations, ['runtime-leak'])
  expect(annotated.length).toBe(2)
  const leak = annotated.find((v) => v.rule === 'runtime-leak')
  const electronToSrc = annotated.find((v) => v.rule === 'electron-to-src')
  expect(leak.allowed).toBe(true)
  expect(electronToSrc.allowed).toBe(false)
  expect(enforceCount).toBe(1) // 只有未豁免的 electron-to-src 计入
})

test('partitionViolations: 不传 allowedRules 时全部违规计入 enforceCount（豁免不是失效）', () => {
  const root = fixture({
    'electron/main/foo.ts': "import { query } from '@anthropic-ai/claude-agent-sdk'\n",
  })
  const violations = collectViolations(root)
  const { enforceCount } = partitionViolations(violations, [])
  expect(enforceCount).toBe(violations.length)
})
