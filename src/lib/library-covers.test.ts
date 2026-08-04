import { statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import { getLibraryCoverPreset, listLibraryCoverPresets } from './library-covers'

function coverAssetPath(fileName: string): string {
  return fileURLToPath(new URL(`../assets/library-covers/${fileName}`, import.meta.url))
}

describe('library cover registry', () => {
  test('uses compressed WebP production assets only', () => {
    const covers = listLibraryCoverPresets()

    expect(covers).toHaveLength(12)
    for (const cover of covers) {
      expect(cover.src).toContain('/assets/library-covers/')
      expect(cover.src).toMatch(/\.webp$/)
      expect(cover.src).not.toContain('.png')
    }
    expect(getLibraryCoverPreset('cover-03').src).toContain('cover-03.webp')
    expect(getLibraryCoverPreset('missing').id).toBe('cover-01')
  })

  test('keeps built-in cover assets under the package budget', () => {
    const covers = listLibraryCoverPresets()
    const sizes = covers.map((cover) => {
      const fileName = `${cover.id}.webp`
      return statSync(coverAssetPath(fileName)).size
    })
    const totalSize = sizes.reduce((total, size) => total + size, 0)

    expect(Math.max(...sizes)).toBeLessThan(64 * 1024)
    expect(totalSize).toBeLessThan(400 * 1024)
  })
})
