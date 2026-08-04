import { describe, expect, test } from 'bun:test'

import {
  bibleGroupDir,
  chapterContextPackCandidates,
  chapterContextPackPath,
  chapterFileName,
  chapterFileNameCandidates,
  chapterManuscriptCandidates,
  chapterManuscriptPath,
  chapterOutlineCandidates,
  chapterOutlineDataCandidates,
  chapterOutlineDataPath,
  chapterOutlinePath,
  chapterReviewCandidates,
  chapterReviewPath,
  chapterDeepReviewCandidates,
  chapterDeepReviewPath,
  charactersDir,
  masterOutlinePath,
  narracatConfigPath,
  narracatStatePath,
  outlineStructurePath,
  premisePath,
  projectScaffoldDirectories,
  referenceGuidanceIndexPath,
  referencesDir,
  relationshipsPath,
  styleGuidePath,
  volumeDirName,
  volumeOutlinePath,
  worldDir,
} from './novel-layout'

describe('naming primitives', () => {
  test('volume directory names zero-pad to two digits but never truncate', () => {
    expect(volumeDirName(1)).toBe('vol-01')
    expect(volumeDirName(12)).toBe('vol-12')
    expect(volumeDirName(100)).toBe('vol-100')
  })

  test('chapter file names zero-pad to three digits but never truncate', () => {
    expect(chapterFileName(1)).toBe('ch-001.md')
    expect(chapterFileName(42)).toBe('ch-042.md')
    expect(chapterFileName(1000)).toBe('ch-1000.md')
  })

  test('chapter file name candidates expose padded then legacy variants', () => {
    expect(chapterFileNameCandidates(1)).toEqual(['ch-001.md', 'ch-1.md'])
  })
})

describe('.narracat system files', () => {
  test('config and state live under .narracat', () => {
    expect(narracatConfigPath()).toBe('.narracat/config.yaml')
    expect(narracatStatePath()).toBe('.narracat/state.yaml')
  })

  test('context pack path is canonical, candidates fall back to legacy name', () => {
    expect(chapterContextPackPath(1)).toBe('.narracat/context-packs/ch-001.json')
    expect(chapterContextPackCandidates(1)).toEqual([
      '.narracat/context-packs/ch-001.json',
      '.narracat/context-packs/ch-1.json',
    ])
  })
})

describe('bible paths', () => {
  test('named foundation documents and group directories', () => {
    expect(premisePath()).toBe('bible/premise.md')
    expect(relationshipsPath()).toBe('bible/relationships.md')
    expect(styleGuidePath()).toBe('bible/style-guide.md')
    expect(charactersDir()).toBe('bible/characters')
    expect(worldDir()).toBe('bible/world')
    expect(referencesDir()).toBe('bible/references')
    expect(referenceGuidanceIndexPath()).toBe('bible/reference-guidance/index.md')
    expect(bibleGroupDir('scenes')).toBe('bible/scenes')
  })
})

describe('outline paths', () => {
  test('master, volume, and chapter outline paths', () => {
    expect(masterOutlinePath()).toBe('outline/master-outline.md')
    expect(volumeOutlinePath(1)).toBe('outline/vol-01/vol-outline.md')
    expect(chapterOutlinePath(1, 2)).toBe('outline/vol-01/ch-002.md')
  })

  test('chapter outline candidates are padded then legacy under the volume dir', () => {
    expect(chapterOutlineCandidates(1, 2)).toEqual(['outline/vol-01/ch-002.md', 'outline/vol-01/ch-2.md'])
  })

  test('structured outline data contract paths (ADR-0018)', () => {
    expect(outlineStructurePath()).toBe('outline/outline-structure.json')
    expect(chapterOutlineDataPath(1, 2)).toBe('outline/vol-01/ch-002.json')
  })

  test('chapter outline data candidates are padded then legacy json under the volume dir', () => {
    expect(chapterOutlineDataCandidates(1, 2)).toEqual([
      'outline/vol-01/ch-002.json',
      'outline/vol-01/ch-2.json',
    ])
  })
})

describe('manuscript paths', () => {
  test('canonical manuscript path lives under the volume directory', () => {
    expect(chapterManuscriptPath(1, 1)).toBe('manuscript/vol-01/ch-001.md')
  })

  test('manuscript candidates check the volume dir then the flat dir, padded before legacy', () => {
    expect(chapterManuscriptCandidates(1, 1)).toEqual([
      'manuscript/vol-01/ch-001.md',
      'manuscript/vol-01/ch-1.md',
      'manuscript/ch-001.md',
      'manuscript/ch-1.md',
    ])
  })
})

describe('review paths', () => {
  test('canonical review path uses the -review.json contract suffix', () => {
    expect(chapterReviewPath(1)).toBe('reviews/ch-001-review.json')
  })

  test('review candidates default to the -review.json variants only', () => {
    expect(chapterReviewCandidates(1)).toEqual(['reviews/ch-001-review.json', 'reviews/ch-1-review.json'])
  })

  test('recovery inspection widens review candidates to plain chapter files', () => {
    expect(chapterReviewCandidates(1, { includePlainChapterFile: true })).toEqual([
      'reviews/ch-001-review.json',
      'reviews/ch-1-review.json',
      'reviews/ch-001.md',
      'reviews/ch-1.md',
    ])
  })

  test('deep-review path is a markdown report living alongside the light review', () => {
    expect(chapterDeepReviewPath(1)).toBe('reviews/ch-001-deep-review.md')
    expect(chapterDeepReviewCandidates(1)).toEqual([
      'reviews/ch-001-deep-review.md',
      'reviews/ch-1-deep-review.md',
    ])
  })
})

describe('project scaffold', () => {
  test('lists every directory a fresh Novel project needs', () => {
    expect(projectScaffoldDirectories()).toEqual([
      '.narracat',
      '.narracat/context-packs',
      'bible/characters',
      'bible/world',
      'bible/references',
      'outline',
      'manuscript',
      'reviews',
      'notes',
    ])
  })
})
