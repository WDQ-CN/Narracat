import { describe, expect, test } from 'bun:test'
import {
  EMPTY_LOAD_STATE,
  beginLoad,
  completeLoad,
  createLoadIssue,
  failLoad,
  runWithFiniteRetry,
} from './load-state'

describe('load state', () => {
  test('distinguishes first-load failure from stale last-good data', () => {
    const issue = createLoadIssue('library', new Error('/Users/example/secret-novel/state.yaml failed'))

    expect(failLoad(EMPTY_LOAD_STATE, issue)).toMatchObject({
      status: 'error',
      hasData: false,
    })
    expect(failLoad(completeLoad(), issue)).toMatchObject({
      status: 'stale',
      hasData: true,
    })
    expect(issue.summary).not.toContain('/Users')
    expect(issue.id).toMatch(/^NC-LIB-[0-9A-F]{8}$/)
  })

  test('loading preserves whether a last-good result exists', () => {
    expect(beginLoad(EMPTY_LOAD_STATE).hasData).toBe(false)
    expect(beginLoad(completeLoad()).hasData).toBe(true)
  })

  test('automatic retry is finite and returns the second successful attempt', async () => {
    const attempts: number[] = []

    const result = await runWithFiniteRetry(async (attempt) => {
      attempts.push(attempt)
      if (attempt === 1) throw new Error('temporary')
      return 'ok'
    })

    expect(result).toBe('ok')
    expect(attempts).toEqual([1, 2])
  })

  test('automatic retry stops after the configured attempt count', async () => {
    const attempts: number[] = []

    await expect(
      runWithFiniteRetry(async (attempt) => {
        attempts.push(attempt)
        throw new Error('still broken')
      }),
    ).rejects.toThrow('still broken')

    expect(attempts).toEqual([1, 2])
  })
})
