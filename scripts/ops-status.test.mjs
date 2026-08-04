import { describe, expect, test } from 'bun:test'

import { formatOpsStatus, parseProgressSections } from './ops-status.mjs'

const progressFixture = `# Project Progress

## Now

- 稳定插件资源同步
- 复核 Golden Path

## Next

- 完善插件版本锁定
- 补齐测试 fixture

## Later

- 接入外部任务追踪

## Blockers

- 暂无已确认阻塞
`

describe('ops status', () => {
  test('parses the active progress sections used for handoff', () => {
    expect(parseProgressSections(progressFixture)).toEqual({
      Now: ['稳定插件资源同步', '复核 Golden Path'],
      Next: ['完善插件版本锁定', '补齐测试 fixture'],
      Blockers: ['暂无已确认阻塞'],
    })
  })

  test('formats a compact status report', () => {
    const report = formatOpsStatus({
      branchLine: '## codex/novel-workbench-optimization...origin/codex/novel-workbench-optimization',
      changes: [' M AGENTS.md', '?? CONTEXT.md'],
      latestCommit: 'fd14554 fix: stabilize narracat plugin resource setup',
      sections: parseProgressSections(progressFixture),
    })

    expect(report).toContain('Branch')
    expect(report).toContain('codex/novel-workbench-optimization')
    expect(report).toContain('Changed Files')
    expect(report).toContain('AGENTS.md')
    expect(report).toContain('Latest Commit')
    expect(report).toContain('fd14554')
    expect(report).toContain('Now')
    expect(report).toContain('稳定插件资源同步')
    expect(report).toContain('Blockers')
  })
})
