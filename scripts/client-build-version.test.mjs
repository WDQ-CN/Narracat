import { describe, expect, test } from 'bun:test'

import {
  CLIENT_BUILD_VERSION_PREFIX,
  formatClientBuildVersion,
  readGitCommitCount,
  resolveClientBuildVersion,
} from './client-build-version.mjs'

describe('client build version', () => {
  test('formats the release commit count as the user-facing client version', () => {
    expect(CLIENT_BUILD_VERSION_PREFIX).toBe('0.1')
    expect(formatClientBuildVersion(253)).toBe('0.1.253')
  })

  test('rejects invalid commit counts', () => {
    expect(() => formatClientBuildVersion(-1)).toThrow('commit count')
    expect(() => formatClientBuildVersion(1.5)).toThrow('commit count')
  })

  test('resolves the version through an injectable commit-count reader', () => {
    expect(resolveClientBuildVersion({ readCommitCount: () => 42 })).toBe('0.1.42')
  })

  test('falls back to the macOS git path when PATH lookup is unavailable', () => {
    const commands = []
    const count = readGitCommitCount('/repo', {
      execFile: (command) => {
        commands.push(command)
        if (command === 'git') throw Object.assign(new Error('missing git'), { code: 'ENOENT' })
        return '7\n'
      },
    })

    expect(count).toBe(7)
    expect(commands).toEqual(['git', '/usr/bin/git'])
  })
})
