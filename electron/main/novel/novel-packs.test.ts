import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { diffNovelPacksEnabledEvents, readNovelPacks, writeNovelPacks } from './novel-packs'

let projectPath: string
beforeEach(() => { projectPath = mkdtempSync(join(tmpdir(), 'novel-packs-')) })
afterEach(() => rmSync(projectPath, { recursive: true, force: true }))

describe('novel-packs', () => {
  test('文件缺失 → 默认启用 official-base（对象条目）', async () => {
    expect(await readNovelPacks(projectPath)).toEqual({ format_version: 1, enabled: [{ id: 'official-base' }] })
  })
  test('write→read 往返（官方条目无 version，导入条目带版本锁）', async () => {
    await writeNovelPacks(projectPath, [{ id: 'official-base' }, { id: 'my-pack', version: '1.0.0' }])
    expect((await readNovelPacks(projectPath)).enabled).toEqual([{ id: 'official-base' }, { id: 'my-pack', version: '1.0.0' }])
  })
  test('损坏 json → 回退默认不 throw', async () => {
    await writeNovelPacks(projectPath, [])
    const { writeFileSync } = await import('node:fs')
    writeFileSync(join(projectPath, '.narracat', 'packs.json'), '{broken')
    expect((await readNovelPacks(projectPath)).enabled).toEqual([{ id: 'official-base' }])
  })
  test('写入含同 id 重复条目 → 归一化为一条（首次出现者保留）', async () => {
    await writeNovelPacks(projectPath, [
      { id: 'official-base' },
      { id: 'my-pack', version: '1.0.0' },
      { id: 'official-base' },
      { id: 'my-pack', version: '1.1.0' },
    ])
    expect((await readNovelPacks(projectPath)).enabled).toEqual([
      { id: 'official-base' },
      { id: 'my-pack', version: '1.0.0' },
    ])
  })
})

describe('diffNovelPacksEnabledEvents（B2 刀3 Task 10 事件埋点三态）', () => {
  test('新清单多出的 id → enable', () => {
    const events = diffNovelPacksEnabledEvents(
      [{ id: 'official-base' }],
      [{ id: 'official-base' }, { id: 'my-pack', version: '1.0.0' }],
    )
    expect(events).toEqual([{ action: 'enable', packId: 'my-pack', version: '1.0.0' }])
  })

  test('旧清单少了的 id → disable', () => {
    const events = diffNovelPacksEnabledEvents(
      [{ id: 'official-base' }, { id: 'my-pack', version: '1.0.0' }],
      [{ id: 'official-base' }],
    )
    expect(events).toEqual([{ action: 'disable', packId: 'my-pack', version: '1.0.0' }])
  })

  test('同 id 版本变化 → upgrade（新版本号）', () => {
    const events = diffNovelPacksEnabledEvents(
      [{ id: 'my-pack', version: '1.0.0' }],
      [{ id: 'my-pack', version: '1.1.0' }],
    )
    expect(events).toEqual([{ action: 'upgrade', packId: 'my-pack', version: '1.1.0' }])
  })

  test('同 id 同版本（含官方条目双 undefined）→ 无事件', () => {
    const events = diffNovelPacksEnabledEvents(
      [{ id: 'official-base' }, { id: 'my-pack', version: '1.0.0' }],
      [{ id: 'official-base' }, { id: 'my-pack', version: '1.0.0' }],
    )
    expect(events).toEqual([])
  })

  test('一次 set 混合三态：enable+disable+upgrade 同时出现', () => {
    const events = diffNovelPacksEnabledEvents(
      [{ id: 'a' }, { id: 'b', version: '1.0.0' }],
      [{ id: 'b', version: '2.0.0' }, { id: 'c' }],
    )
    expect(events.sort((x, y) => x.action.localeCompare(y.action))).toEqual([
      { action: 'disable', packId: 'a' },
      { action: 'enable', packId: 'c' },
      { action: 'upgrade', packId: 'b', version: '2.0.0' },
    ])
  })
})
