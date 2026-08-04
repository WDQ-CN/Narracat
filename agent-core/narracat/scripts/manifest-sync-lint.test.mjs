import { test } from 'node:test'
import assert from 'node:assert/strict'
import { lintManifestSync } from './manifest-sync-lint.mjs'

const manifest = { commands: ['a'], agents: ['x'], skills: [], schemas: [], templates: [] }

test('目录有清单无 → 违规', () => {
  const disk = { commands: ['a', 'b'], agents: ['x'], skills: [], schemas: [], templates: [] }
  const violations = lintManifestSync({ manifest, disk })
  assert.equal(violations.length, 1)
  assert.match(violations[0], /commands.*b.*不在 manifest/)
})

test('清单有目录无 → 违规', () => {
  const disk = { commands: ['a'], agents: [], skills: [], schemas: [], templates: [] }
  const violations = lintManifestSync({ manifest, disk })
  assert.equal(violations.length, 1)
  assert.match(violations[0], /agents.*x.*文件不存在/)
})

test('双向一致 → 零违规', () => {
  const disk = { commands: ['a'], agents: ['x'], skills: [], schemas: [], templates: [] }
  assert.deepEqual(lintManifestSync({ manifest, disk }), [])
})
