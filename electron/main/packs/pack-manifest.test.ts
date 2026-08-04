// App 侧 pack.json manifest 校验镜像测试——同引擎 `pack-manifest.test.ts` 断言序列，
// 证明 SemVer 契约 + 卡 id 唯一性两侧语义一致（PR#474 审核修复）。

import { describe, expect, test } from 'bun:test'
import { PACK_FORMAT_VERSION } from '@shared/types/capability-pack'
import { validatePackManifest } from './pack-manifest'

const validManifest = {
  pack_format_version: PACK_FORMAT_VERSION,
  id: 'my-pack',
  name: '测试包',
  author: 'tester',
  version: '1.0.0',
  cards: [
    { type: 'persona', path: 'cards/p.md', id: 'p1', name: '卡一', keywords: ['冷'] },
    {
      type: 'craft', path: 'cards/c.md', id: 'c1', triggers: ['危机'], beat_types: ['action'],
      technique_tags: ['动作细节'], emotion_tags: ['紧张'], exclusions: [], priority: 2,
    },
    { type: 'structure', path: 'cards/s.md', id: 's1', dimension: 'D1', stage: 'stage-1', one_line: '一句话' },
  ],
}

describe('validatePackManifest（App 镜像）', () => {
  test('合法 manifest → manifest 非空且无 errors', () => {
    const r = validatePackManifest(validManifest)
    expect(r.errors).toEqual([])
    expect(r.manifest?.cards).toHaveLength(3)
  })

  test('id 含路径穿越片段（如「../evil」）→ fail-loud（终审 Critical：id 直接拼进 `<id>@<version>` 磁盘路径）', () => {
    const r = validatePackManifest({ ...validManifest, id: '../evil' })
    expect(r.manifest).toBeNull()
    expect(r.errors.join()).toContain('非法字符')
  })

  test('version 非合法 SemVer（如「banana」）→ fail-loud', () => {
    const r = validatePackManifest({ ...validManifest, version: 'banana' })
    expect(r.manifest).toBeNull()
    expect(r.errors.join()).toContain('SemVer')
  })

  test('version 带 build metadata（+）→ fail-loud', () => {
    const r = validatePackManifest({ ...validManifest, version: '1.0.0+build.1' })
    expect(r.manifest).toBeNull()
    expect(r.errors.join()).toContain('SemVer')
  })

  test('version 带合法预发布标识（1.0.0-beta.1）→ 通过', () => {
    const r = validatePackManifest({ ...validManifest, version: '1.0.0-beta.1' })
    expect(r.errors).toEqual([])
    expect(r.manifest?.version).toBe('1.0.0-beta.1')
  })

  test('同 id 卡在包内重复 → fail-loud', () => {
    const r = validatePackManifest({
      ...validManifest,
      cards: [
        { type: 'persona', path: 'cards/p.md', id: 'p1', name: '卡一', keywords: ['冷'] },
        { type: 'structure', path: 'cards/s.md', id: 'p1', dimension: 'D1', stage: 'stage-1', one_line: '一句话' },
      ],
    })
    expect(r.manifest).toBeNull()
    expect(r.errors.join()).toContain('重复')
  })

  test('跳过的未知类型卡不参与 id 唯一性判定', () => {
    const r = validatePackManifest({
      ...validManifest,
      cards: [
        { type: 'persona', path: 'cards/p.md', id: 'dup', name: '卡一', keywords: ['冷'] },
        { type: 'hologram', path: 'cards/h.bin', id: 'dup' },
      ],
    })
    expect(r.errors).toEqual([])
    expect(r.manifest?.cards).toHaveLength(1)
  })

  test('带权利元数据的 manifest 通过且字段透出', () => {
    const r = validatePackManifest({
      ...validManifest,
      content_hash: 'abc123',
      license: 'free-use',
      derived_from: 'other-pack',
    })
    expect(r.errors).toEqual([])
    expect(r.manifest?.content_hash).toBe('abc123')
    expect(r.manifest?.license).toBe('free-use')
    expect(r.manifest?.derived_from).toBe('other-pack')
  })

  test('license 非法值 → warning 降级为 undefined，不报错（导入宽容）', () => {
    const r = validatePackManifest({ ...validManifest, license: 'do-whatever' })
    expect(r.errors).toEqual([])
    expect(r.manifest).not.toBeNull()
    expect(r.manifest?.license).toBeUndefined()
    expect(r.warnings.join()).toContain('license')
  })
})
