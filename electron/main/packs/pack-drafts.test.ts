import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import AdmZip from 'adm-zip'
import {
  listPackDrafts,
  createPackDraft,
  getPackDraft,
  updatePackDraft,
  deletePackDraft,
  exportPackDraftProject,
  importPackDraftProject,
  packDraftsDir,
} from './pack-drafts'
import type { DraftCard } from '@shared/types/capability-pack'

let tmp: string, userDataPath: string

/** 格式合法但不存在的 draftId——用于区分"不存在"语义与"格式非法/穿越"语义（后者见路径穿越纵深守卫用例）。 */
const NONEXISTENT_DRAFT_ID = '00000000-0000-0000-0000-000000000000'

const sampleCard: DraftCard = {
  cardId: 'c1',
  type: 'persona',
  name: '声音',
  oneLine: '冷静克制',
  body: '正文内容',
  intent: '写一个冷静的角色声音',
  compiled: null,
}

/** 与 pack-store.test.ts 同款技巧：等长字面替换伪造含 `../` 的恶意 zip entry（adm-zip addFile 会净化路径）。 */
function buildMaliciousZip(zipPath: string): void {
  const placeholder = 'XX/evil.txt'
  const malicious = '../evil.txt'
  if (placeholder.length !== malicious.length) throw new Error('占位名与恶意名长度不等，会打乱 zip 字节偏移')
  const zip = new AdmZip()
  zip.addFile(placeholder, Buffer.from('x'))
  const patched = Buffer.from(zip.toBuffer().toString('binary').split(placeholder).join(malicious), 'binary')
  writeFileSync(zipPath, patched)
}

/** 直接改写磁盘上 draft.json 的 meta.updatedAt——绕开 store 的实时时钟，构造确定性的排序 fixture。 */
function patchUpdatedAt(userDataPath: string, draftId: string, updatedAt: string): void {
  const path = join(packDraftsDir(userDataPath), draftId, 'draft.json')
  const file = JSON.parse(readFileSync(path, 'utf8'))
  file.meta.updatedAt = updatedAt
  writeFileSync(path, JSON.stringify(file, null, 2))
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pack-drafts-'))
  userDataPath = join(tmp, 'userData')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('create → get 往返', () => {
  test('逐字段回读', async () => {
    const meta = await createPackDraft({
      userDataPath,
      name: '我的题材包',
      derivedFrom: 'novel-123',
      seed: { cards: [sampleCard], readme: '# 说明', author: '作者甲', description: '一个草稿' },
    })
    expect(meta.name).toBe('我的题材包')
    expect(meta.derivedFrom).toBe('novel-123')
    expect(meta.author).toBe('作者甲')
    expect(meta.description).toBe('一个草稿')
    expect(meta.lastPublishedVersion).toBeNull()
    expect(typeof meta.draftId).toBe('string')
    expect(typeof meta.updatedAt).toBe('string')

    const got = await getPackDraft({ userDataPath, draftId: meta.draftId })
    expect(got).not.toBeNull()
    expect(got!.meta).toEqual(meta)
    expect(got!.cards).toEqual([sampleCard])
    expect(got!.readme).toBe('# 说明')
  })

  test('无 seed 时字段有合理默认值', async () => {
    const meta = await createPackDraft({ userDataPath, name: '空白草稿' })
    expect(meta.author).toBe('')
    expect(meta.description).toBe('')
    expect(meta.derivedFrom).toBeNull()
    const got = await getPackDraft({ userDataPath, draftId: meta.draftId })
    expect(got!.cards).toEqual([])
    expect(got!.readme).toBe('')
  })

  test('不存在的 draftId → null', async () => {
    expect(await getPackDraft({ userDataPath, draftId: NONEXISTENT_DRAFT_ID })).toBeNull()
  })
})

describe('updatePackDraft', () => {
  test('改 name + cards 后回读一致；draftId 不可被 patch 覆盖', async () => {
    const meta = await createPackDraft({ userDataPath, name: '旧名' })
    const newCard: DraftCard = { ...sampleCard, cardId: 'c2', name: '新卡' }
    await updatePackDraft({
      userDataPath,
      draftId: meta.draftId,
      patch: { meta: { name: '新名', draftId: 'should-be-ignored' }, cards: [newCard] },
    })
    const got = await getPackDraft({ userDataPath, draftId: meta.draftId })
    expect(got!.meta.name).toBe('新名')
    expect(got!.meta.draftId).toBe(meta.draftId)
    expect(got!.cards).toEqual([newCard])
    expect(got!.meta.updatedAt).not.toBe(meta.updatedAt)
  })

  test('patch.readme 更新 README；不传则保留原值', async () => {
    const meta = await createPackDraft({ userDataPath, name: 'x', seed: { cards: [], readme: '旧readme' } })
    await updatePackDraft({ userDataPath, draftId: meta.draftId, patch: { readme: '新readme' } })
    expect((await getPackDraft({ userDataPath, draftId: meta.draftId }))!.readme).toBe('新readme')
    await updatePackDraft({ userDataPath, draftId: meta.draftId, patch: { meta: { name: 'y' } } })
    expect((await getPackDraft({ userDataPath, draftId: meta.draftId }))!.readme).toBe('新readme')
  })

  test('草稿不存在 → 抛错', async () => {
    await expect(updatePackDraft({ userDataPath, draftId: NONEXISTENT_DRAFT_ID, patch: {} })).rejects.toThrow()
  })
})

describe('listPackDrafts', () => {
  test('按 updatedAt 降序，插入序与期望排序刻意相反（对 .sort() 有判别力）', async () => {
    // 创建顺序 a → b → c；直接改写磁盘 updatedAt 让排序结果与创建顺序完全相反（c 最新、a 最旧）。
    // 若实现里误删 .sort()，readdir 在绝大多数文件系统上会退化为近似插入序 [a,b,c]，
    // 与这里断言的期望序 [c,b,a] 必然不符——该 fixture 已手工验证：删掉 .sort() 复跑本测试会红
    // （见 task-5-report.md「删 sort 验红」记录），不依赖真实时钟差异，不受毫秒级 tie 影响。
    const a = await createPackDraft({ userDataPath, name: 'A' })
    const b = await createPackDraft({ userDataPath, name: 'B' })
    const c = await createPackDraft({ userDataPath, name: 'C' })
    patchUpdatedAt(userDataPath, a.draftId, '2020-01-01T00:00:00.000Z')
    patchUpdatedAt(userDataPath, b.draftId, '2021-01-01T00:00:00.000Z')
    patchUpdatedAt(userDataPath, c.draftId, '2022-01-01T00:00:00.000Z')

    const list = await listPackDrafts({ userDataPath })
    expect(list.map((m) => m.draftId)).toEqual([c.draftId, b.draftId, a.draftId])
  })

  test('空目录 → 空数组', async () => {
    expect(await listPackDrafts({ userDataPath })).toEqual([])
  })

  test('损坏的 draft.json 跳过并继续（fail-soft）', async () => {
    const good = await createPackDraft({ userDataPath, name: '正常草稿' })
    const brokenDir = join(packDraftsDir(userDataPath), 'broken-id')
    mkdirSync(brokenDir, { recursive: true })
    writeFileSync(join(brokenDir, 'draft.json'), '{ not valid json')
    const list = await listPackDrafts({ userDataPath })
    expect(list.map((m) => m.draftId)).toEqual([good.draftId])
  })

  test('meta 字段不齐全的 draft.json 也跳过（结构校验，非纯 parse 失败）', async () => {
    const good = await createPackDraft({ userDataPath, name: '正常草稿2' })
    const incompleteDir = join(packDraftsDir(userDataPath), 'incomplete-id')
    mkdirSync(incompleteDir, { recursive: true })
    writeFileSync(join(incompleteDir, 'draft.json'), JSON.stringify({ meta: { draftId: 'incomplete-id' }, cards: [] }))
    const list = await listPackDrafts({ userDataPath })
    expect(list.map((m) => m.draftId)).toEqual([good.draftId])
  })
})

describe('deletePackDraft', () => {
  test('删除后 get 为 null，且不在 list 中', async () => {
    const meta = await createPackDraft({ userDataPath, name: '待删' })
    await deletePackDraft({ userDataPath, draftId: meta.draftId })
    expect(await getPackDraft({ userDataPath, draftId: meta.draftId })).toBeNull()
    expect(await listPackDrafts({ userDataPath })).toEqual([])
  })

  test('删除不存在的 draftId 不抛错', async () => {
    await expect(deletePackDraft({ userDataPath, draftId: NONEXISTENT_DRAFT_ID })).resolves.toBeUndefined()
  })
})

describe('export → import 往返', () => {
  test('逐字段相等且新 draftId', async () => {
    const original = await createPackDraft({
      userDataPath,
      name: '往返测试包',
      derivedFrom: 'novel-9',
      seed: { cards: [sampleCard], readme: '# readme', author: '作者乙', description: '描述文本' },
    })
    const zipPath = join(tmp, 'export.narracatproj')
    await exportPackDraftProject({ userDataPath, draftId: original.draftId, targetPath: zipPath })

    const importedMeta = await importPackDraftProject({ userDataPath, sourcePath: zipPath })
    expect(importedMeta.draftId).not.toBe(original.draftId)
    expect(importedMeta.name).toBe(original.name)
    expect(importedMeta.author).toBe(original.author)
    expect(importedMeta.description).toBe(original.description)
    expect(importedMeta.derivedFrom).toBe(original.derivedFrom)
    expect(importedMeta.lastPublishedVersion).toBe(original.lastPublishedVersion)

    const importedFull = await getPackDraft({ userDataPath, draftId: importedMeta.draftId })
    expect(importedFull!.cards).toEqual([sampleCard])
    expect(importedFull!.readme).toBe('# readme')

    // 原草稿仍在，两者独立并存（同一份工程可反复导入不撞 id）
    expect(await getPackDraft({ userDataPath, draftId: original.draftId })).not.toBeNull()
  })

  test('导出不存在的草稿 → 抛错', async () => {
    await expect(
      exportPackDraftProject({ userDataPath, draftId: NONEXISTENT_DRAFT_ID, targetPath: join(tmp, 'x.narracatproj') }),
    ).rejects.toThrow()
  })

  test('含 `../` 条目的恶意 zip 被拒，且不写出 pack-drafts 目录之外', async () => {
    const zipPath = join(tmp, 'evil.narracatproj')
    buildMaliciousZip(zipPath)
    // 先证真：patch 后的 zip 里确实是恶意 entryName，不是自证清白式的「反正没抛错就当过了」（同 pack-store.test.ts）。
    expect(new AdmZip(zipPath).getEntries().map((e) => e.entryName)).toEqual(['../evil.txt'])
    await expect(importPackDraftProject({ userDataPath, sourcePath: zipPath })).rejects.toThrow()
    expect(await listPackDrafts({ userDataPath })).toEqual([])
    // 恶意条目本应落在 tmp/../evil.txt = tmp 的上一级；确认真的没有逃出去
    expect(existsSync(join(tmp, '..', 'evil.txt'))).toBe(false)
  })

  test('draft.json 缺失/结构不齐全的 zip 被拒', async () => {
    const badDir = join(tmp, 'bad-project')
    mkdirSync(badDir, { recursive: true })
    writeFileSync(join(badDir, 'draft.json'), JSON.stringify({ meta: { name: '缺字段' }, cards: [] }))
    const zip = new AdmZip()
    zip.addLocalFolder(badDir)
    const zipPath = join(tmp, 'bad.narracatproj')
    zip.writeZip(zipPath)
    await expect(importPackDraftProject({ userDataPath, sourcePath: zipPath })).rejects.toThrow()
    expect(await listPackDrafts({ userDataPath })).toEqual([])
  })

  test('工程目录含符号链接 → 导出被拒（防止 zip 打包时跟随链接泄漏包外文件内容）', async () => {
    const meta = await createPackDraft({ userDataPath, name: '带链接的草稿' })
    const outsideFile = join(tmp, 'secret.txt')
    writeFileSync(outsideFile, '机密内容')
    symlinkSync(outsideFile, join(packDraftsDir(userDataPath), meta.draftId, 'evil-link'))
    await expect(
      exportPackDraftProject({ userDataPath, draftId: meta.draftId, targetPath: join(tmp, 'out.narracatproj') }),
    ).rejects.toThrow(/符号链接/)
  })
})

describe('exportPackDraftProject：learned-external 硬门（拍板3，合规收口）', () => {
  test('meta.localSource === learned-external → 导出被拒，错误信息含「学自外部书」', async () => {
    const meta = await createPackDraft({ userDataPath, name: '学自外部书的工程' })
    await updatePackDraft({ userDataPath, draftId: meta.draftId, patch: { meta: { localSource: 'learned-external' } } })
    await expect(
      exportPackDraftProject({ userDataPath, draftId: meta.draftId, targetPath: join(tmp, 'out.narracatproj') }),
    ).rejects.toThrow(/学自外部书/)
  })

  test('对照：learned-own 工程导出照常成功', async () => {
    const meta = await createPackDraft({ userDataPath, name: '学自自己书的工程' })
    await updatePackDraft({ userDataPath, draftId: meta.draftId, patch: { meta: { localSource: 'learned-own' } } })
    const zipPath = join(tmp, 'own.narracatproj')
    await exportPackDraftProject({ userDataPath, draftId: meta.draftId, targetPath: zipPath })
    expect(existsSync(zipPath)).toBe(true)
  })

  test('对照：无 localSource 的普通工程导出照常成功', async () => {
    const meta = await createPackDraft({ userDataPath, name: '普通工程' })
    const zipPath = join(tmp, 'plain.narracatproj')
    await exportPackDraftProject({ userDataPath, draftId: meta.draftId, targetPath: zipPath })
    expect(existsSync(zipPath)).toBe(true)
  })

  test('draft.json 损坏（无法解析 localSource）→ fail-closed 拒绝导出，而非静默放行（评审修复波）', async () => {
    const meta = await createPackDraft({ userDataPath, name: '损坏的工程' })
    // 直接在磁盘上写坏 draft.json：readDraftFile 内部 JSON.parse 失败会 fail-soft 返回 null——
    // 若导出侧用 `file?.meta.localSource === 'learned-external'` 判断，file 为 null 时整个表达式
    // 短路成 false，反而放行导出（学自外部书但读不出 localSource 的工程也会被打包带走）。
    // 与 pack-store.ts manifest 损坏 fail-closed 的先例相反，必须改成 file 为 null 就直接拒绝。
    writeFileSync(join(packDraftsDir(userDataPath), meta.draftId, 'draft.json'), '{ 这不是合法 JSON')
    await expect(
      exportPackDraftProject({ userDataPath, draftId: meta.draftId, targetPath: join(tmp, 'corrupt.narracatproj') }),
    ).rejects.toThrow(/无法读取/)
  })
})

describe('IPC 白名单后的 patch 不能洗掉来源锁（PR#477 P1-3 store 级端到端）', () => {
  test('learned-external 草稿经白名单后的 patch 改 name → localSource 仍是 learned-external → 导出仍被拒', async () => {
    const meta = await createPackDraft({ userDataPath, name: '学自外部书的工程' })
    await updatePackDraft({ userDataPath, draftId: meta.draftId, patch: { meta: { localSource: 'learned-external' } } })
    // 模拟经 electron/main/ipc/pack-draft-input.ts 白名单重建后的 patch：只剩 name，
    // localSource/learnedFrom 等字段已被 IPC 层丢弃，压根传不到这里。
    await updatePackDraft({ userDataPath, draftId: meta.draftId, patch: { meta: { name: '改了个名字' } } })
    const updated = await getPackDraft({ userDataPath, draftId: meta.draftId })
    expect(updated?.meta.name).toBe('改了个名字')
    expect(updated?.meta.localSource).toBe('learned-external')
    await expect(
      exportPackDraftProject({ userDataPath, draftId: meta.draftId, targetPath: join(tmp, 'still-forbidden.narracatproj') }),
    ).rejects.toThrow(/学自外部书/)
  })
})

describe('draftId 路径穿越纵深守卫（Critical，实弹验证过）', () => {
  // sentinel 位于 pack-drafts 目录之外、userDataPath 之内——join(packDraftsDir, '../sensitive-sibling')
  // 折算回 join(userDataPath, 'sensitive-sibling')，正是攻击者用 draftId='../sensitive-sibling' 想够到的目标。
  function makeSentinel(): { sentinelDir: string; sentinelFile: string } {
    const sentinelDir = join(userDataPath, 'sensitive-sibling')
    mkdirSync(sentinelDir, { recursive: true })
    const sentinelFile = join(sentinelDir, 'secret.txt')
    writeFileSync(sentinelFile, '不该被摸到的机密内容')
    return { sentinelDir, sentinelFile }
  }

  test('deletePackDraft：穿越 draftId 不删 pack-drafts 之外的目录，且抛人话错误', async () => {
    const { sentinelFile } = makeSentinel()
    await expect(deletePackDraft({ userDataPath, draftId: '../sensitive-sibling' })).rejects.toThrow()
    expect(existsSync(sentinelFile)).toBe(true)
  })

  test('getPackDraft：穿越 draftId 不读 pack-drafts 之外的文件，直接抛错而非静默 null', async () => {
    makeSentinel()
    await expect(getPackDraft({ userDataPath, draftId: '../sensitive-sibling' })).rejects.toThrow()
  })

  test('updatePackDraft：穿越 draftId 不写 pack-drafts 之外的文件', async () => {
    const { sentinelFile } = makeSentinel()
    const before = readFileSync(sentinelFile, 'utf8')
    await expect(
      updatePackDraft({ userDataPath, draftId: '../sensitive-sibling', patch: { meta: { name: '篡改' } } }),
    ).rejects.toThrow()
    expect(readFileSync(sentinelFile, 'utf8')).toBe(before)
  })

  test('exportPackDraftProject：穿越 draftId 不把 pack-drafts 之外的目录打进 zip 外泄', async () => {
    makeSentinel()
    const zipPath = join(tmp, 'leak.narracatproj')
    await expect(
      exportPackDraftProject({ userDataPath, draftId: '../sensitive-sibling', targetPath: zipPath }),
    ).rejects.toThrow()
    expect(existsSync(zipPath)).toBe(false)
  })

  test('更深层穿越（../../escaped）同样被拒', async () => {
    await expect(deletePackDraft({ userDataPath, draftId: '../../escaped' })).rejects.toThrow()
    await expect(getPackDraft({ userDataPath, draftId: '../../escaped' })).rejects.toThrow()
  })

  test('绝对路径 draftId 同样被拒', async () => {
    await expect(deletePackDraft({ userDataPath, draftId: '/etc/passwd' })).rejects.toThrow()
  })

  test('空字符串 draftId 被拒，不会塌缩成 pack-drafts 根目录（否则 delete 会整删全部草稿）', async () => {
    const a = await createPackDraft({ userDataPath, name: '草稿A' })
    const b = await createPackDraft({ userDataPath, name: '草稿B' })
    await expect(deletePackDraft({ userDataPath, draftId: '' })).rejects.toThrow()
    expect(await getPackDraft({ userDataPath, draftId: a.draftId })).not.toBeNull()
    expect(await getPackDraft({ userDataPath, draftId: b.draftId })).not.toBeNull()
  })

  test('draftId="." 被拒，同样不会塌缩成 pack-drafts 根目录', async () => {
    const a = await createPackDraft({ userDataPath, name: '草稿A' })
    await expect(deletePackDraft({ userDataPath, draftId: '.' })).rejects.toThrow()
    expect(await getPackDraft({ userDataPath, draftId: a.draftId })).not.toBeNull()
  })

  test('非 UUID 格式的普通字符串 draftId 也被拒（白名单，不止防穿越/退化值）', async () => {
    await expect(deletePackDraft({ userDataPath, draftId: 'not-a-real-uuid' })).rejects.toThrow()
  })
})
