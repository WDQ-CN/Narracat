import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { describe, expect, test } from 'bun:test'

import { formatUnsupportedNodeMessage, isSupportedNodeVersion } from './check-node-runtime.mjs'

const execFileAsync = promisify(execFile)

describe('node runtime check', () => {
  test('matches the NarraCat app supported Node 22 runtime', () => {
    expect(isSupportedNodeVersion('v18.20.8')).toBe(false)
    expect(isSupportedNodeVersion('20.18.1')).toBe(false)
    expect(isSupportedNodeVersion('20.19.0')).toBe(false)
    expect(isSupportedNodeVersion('21.7.3')).toBe(false)
    expect(isSupportedNodeVersion('22.11.0')).toBe(false)
    expect(isSupportedNodeVersion('22.12.0')).toBe(true)
    expect(isSupportedNodeVersion('26.0.0')).toBe(false)
  })

  test('prints an actionable message for unsupported runtimes', () => {
    expect(formatUnsupportedNodeMessage('v18.20.8')).toContain('当前 Node.js 版本是 v18.20.8')
    expect(formatUnsupportedNodeMessage('v18.20.8')).toContain('^22.12.0')
    expect(formatUnsupportedNodeMessage('v18.20.8')).toContain('nvm install 22 && nvm use 22')
  })

  test('can be imported from node without running the CLI branch', async () => {
    const result = await execFileAsync('node', [
      '-e',
      "import('./scripts/check-node-runtime.mjs').then(({ isSupportedNodeVersion }) => console.log(isSupportedNodeVersion('v18.20.8')))",
    ])

    expect(result.stdout.trim()).toBe('false')
  })
})
