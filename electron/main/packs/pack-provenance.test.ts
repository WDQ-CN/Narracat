import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  readPackProvenance,
  recordPackProvenance,
  removePackProvenance,
  appendPackEvent,
  packProvenancePath,
  packEventsPath,
  writePackLocalSourceMarker,
  readPackLocalSourceMarker,
} from './pack-provenance'

let tmp: string, userDataPath: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pack-provenance-'))
  userDataPath = join(tmp, 'userData')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('readPackProvenance（PR#477 外审 P1-4：文件不存在=合法初始态 fail-soft；损坏=fail-closed 抛错）', () => {
  test('文件不存在 → 空记录（合法初始态，fail-soft）', async () => {
    expect(await readPackProvenance(userDataPath)).toEqual({})
  })

  // 攻击复现：此前损坏 JSON 被当作「空记录」fail-soft 放行，等价于把全部包的 provenance
  // 记录都抹掉——exportCapabilityPack 查不到 entry 会把 learned-external 包当「imported」
  // 处理直接原样转发导出，绕过来源锁（见 pack-store.test.ts「provenance 文件损坏 → 导出 fail-closed」）。
  // 文件不存在（ENOENT）是合法初始态，必须继续 fail-soft；只有「文件存在但读不出来」才该 fail-closed。
  test('文件损坏 JSON → fail-closed 抛错，不再当空记录放行', async () => {
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(packProvenancePath(userDataPath), '{not json', 'utf8')
    await expect(readPackProvenance(userDataPath)).rejects.toThrow(/本机包来源记录无法读取/)
  })

  test('文件是数组（非对象结构） → fail-closed 抛错', async () => {
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(packProvenancePath(userDataPath), '[]', 'utf8')
    await expect(readPackProvenance(userDataPath)).rejects.toThrow(/本机包来源记录无法读取/)
  })

  test('文件是 null（JSON 合法但非对象） → fail-closed 抛错', async () => {
    mkdirSync(userDataPath, { recursive: true })
    writeFileSync(packProvenancePath(userDataPath), 'null', 'utf8')
    await expect(readPackProvenance(userDataPath)).rejects.toThrow(/本机包来源记录无法读取/)
  })
})

describe('本机来源标记（.narracat-local-source.json，PR#477 P1-4 纵深）', () => {
  test('写入后可读回', async () => {
    const packDir = join(tmp, 'pack-dir')
    mkdirSync(packDir, { recursive: true })
    await writePackLocalSourceMarker(packDir, 'learned-external')
    expect(await readPackLocalSourceMarker(packDir)).toBe('learned-external')
  })

  test('标记文件不存在 → undefined（不影响正常 provenance 门判断）', async () => {
    const packDir = join(tmp, 'no-marker-dir')
    mkdirSync(packDir, { recursive: true })
    expect(await readPackLocalSourceMarker(packDir)).toBeUndefined()
  })

  test('标记文件损坏 → undefined（fail-soft：标记只用于收紧，读不到就退回正常 provenance 门）', async () => {
    const packDir = join(tmp, 'broken-marker-dir')
    mkdirSync(packDir, { recursive: true })
    writeFileSync(join(packDir, '.narracat-local-source.json'), '{not json', 'utf8')
    expect(await readPackLocalSourceMarker(packDir)).toBeUndefined()
  })
})

describe('recordPackProvenance → readPackProvenance 往返', () => {
  test('写入后可读回，目录不存在自动创建', async () => {
    expect(existsSync(userDataPath)).toBe(false)
    await recordPackProvenance(userDataPath, 'user-my-pack@1.0.0', { source: 'created', draftId: 'd1' })
    const record = await readPackProvenance(userDataPath)
    expect(record).toEqual({ 'user-my-pack@1.0.0': { source: 'created', draftId: 'd1' } })
  })

  test('同 key 二次写入覆盖，不影响其他 key', async () => {
    await recordPackProvenance(userDataPath, 'a@1.0.0', { source: 'created', draftId: 'd1' })
    await recordPackProvenance(userDataPath, 'b@1.0.0', { source: 'learned-own' })
    await recordPackProvenance(userDataPath, 'a@1.0.0', { source: 'created', draftId: 'd1', derivedFrom: 'novel-1' })
    const record = await readPackProvenance(userDataPath)
    expect(record).toEqual({
      'a@1.0.0': { source: 'created', draftId: 'd1', derivedFrom: 'novel-1' },
      'b@1.0.0': { source: 'learned-own' },
    })
  })
})

describe('removePackProvenance', () => {
  test('移除已存在的 key', async () => {
    await recordPackProvenance(userDataPath, 'a@1.0.0', { source: 'created' })
    await recordPackProvenance(userDataPath, 'b@1.0.0', { source: 'created' })
    await removePackProvenance(userDataPath, 'a@1.0.0')
    expect(await readPackProvenance(userDataPath)).toEqual({ 'b@1.0.0': { source: 'created' } })
  })

  test('移除不存在的 key 静默跳过，不抛', async () => {
    await recordPackProvenance(userDataPath, 'a@1.0.0', { source: 'created' })
    await removePackProvenance(userDataPath, 'nonexistent@1.0.0')
    expect(await readPackProvenance(userDataPath)).toEqual({ 'a@1.0.0': { source: 'created' } })
  })

  test('文件不存在时调用不抛', async () => {
    await expect(removePackProvenance(userDataPath, 'a@1.0.0')).resolves.toBeUndefined()
  })
})

describe('appendPackEvent', () => {
  test('追加一行可 parse 的 JSON，带 ts', async () => {
    await appendPackEvent(userDataPath, { action: 'publish', packId: 'user-my-pack', version: '1.0.0' })
    const content = readFileSync(packEventsPath(userDataPath), 'utf8')
    const lines = content.trim().split('\n')
    expect(lines.length).toBe(1)
    const parsed = JSON.parse(lines[0])
    expect(parsed.action).toBe('publish')
    expect(parsed.packId).toBe('user-my-pack')
    expect(parsed.version).toBe('1.0.0')
    expect(typeof parsed.ts).toBe('string')
    expect(new Date(parsed.ts).toString()).not.toBe('Invalid Date')
  })

  test('多次追加各占一行，顺序保留', async () => {
    await appendPackEvent(userDataPath, { action: 'publish', packId: 'a' })
    await appendPackEvent(userDataPath, { action: 'enable', packId: 'a', projectPath: '/novel/1' })
    const lines = readFileSync(packEventsPath(userDataPath), 'utf8').trim().split('\n')
    expect(lines.length).toBe(2)
    expect(JSON.parse(lines[0]).action).toBe('publish')
    expect(JSON.parse(lines[1]).action).toBe('enable')
    expect(JSON.parse(lines[1]).projectPath).toBe('/novel/1')
  })
})
