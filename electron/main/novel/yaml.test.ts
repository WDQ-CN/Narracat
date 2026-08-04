import { describe, expect, test } from 'bun:test'

import {
  isRecord,
  parseYamlRecord,
  readNumber,
  stringifyYamlRecord,
} from './yaml'

describe('yaml helpers', () => {
  test('parses YAML object', () => {
    expect(
      parseYamlRecord(
        'title: 星辰大海\nprogress:\n  last_completed_chapter: 1\n',
        'state.yaml',
      ),
    ).toEqual({
      title: '星辰大海',
      progress: { last_completed_chapter: 1 },
    })
  })

  test('rejects scalar YAML with readable file label', () => {
    expect(() => parseYamlRecord('hello', 'config.yaml')).toThrow('config.yaml')
  })

  test('stringifies records with trailing newline', () => {
    expect(stringifyYamlRecord({ title: '星辰大海' })).toBe('title: 星辰大海\n')
  })

  test('rejects non-plain objects as records', () => {
    expect(isRecord(new Date())).toBe(false)
    expect(isRecord(new Map())).toBe(false)
    expect(isRecord(new Set())).toBe(false)
    expect(isRecord(Object.create(null))).toBe(true)
  })

  test('reads only finite numbers', () => {
    expect(readNumber({ chapter: 1 }, 'chapter')).toBe(1)
    expect(readNumber({ chapter: Number.NaN }, 'chapter')).toBeUndefined()
    expect(readNumber({ chapter: Number.POSITIVE_INFINITY }, 'chapter')).toBeUndefined()
    expect(readNumber({ chapter: Number.NEGATIVE_INFINITY }, 'chapter')).toBeUndefined()
  })
})
