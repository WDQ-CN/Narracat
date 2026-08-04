// electron/main/packs/pack-local-content.test.ts
import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readLocalPackContent, copyPackToDraft } from './pack-local-content'
import { createPackDraft, getPackDraft } from './pack-drafts'
import { publishPackDraft } from './pack-publish'
import { recordPackProvenance, removePackProvenance, readPackProvenance } from './pack-provenance'
import { userPacksDir, packVersionDirName } from './pack-store'
import type { DraftCard } from '@shared/types/capability-pack'

let tmp: string, userDataPath: string, agentCorePath: string

const structureCard: DraftCard = {
  cardId: 'aaaaaaaa-0000-0000-0000-000000000001',
  type: 'structure',
  name: '开局钩子',
  oneLine: '三章内抛出核心冲突',
  body: '开局要在三章内亮出主角的核心目标与阻碍。',
  intent: 'stage-1',
  compiled: {
    fields: { stage: 'stage-1', dimension: 'user-defined' },
    echo: '系统的理解：全书布局阶段的编排方法',
    engineVersion: '4.0.0',
    compiledAt: '2026-07-19T00:00:00.000Z',
  },
}

const personaCard: DraftCard = {
  cardId: 'aaaaaaaa-0000-0000-0000-000000000002',
  type: 'persona',
  name: '气质卡',
  oneLine: '热血轻松',
  body: '这本书整体气质热血又轻松，主角嘴硬心软。',
  intent: '一本热血轻松的书',
  compiled: {
    fields: { keywords: ['热血', '轻松'] },
    echo: '系统的理解：适合「热血、轻松」气质的书',
    engineVersion: '4.0.0',
    compiledAt: '2026-07-19T00:00:00.000Z',
  },
}

const craftCard: DraftCard = {
  cardId: 'aaaaaaaa-0000-0000-0000-000000000003',
  type: 'craft',
  name: '战斗前夕紧张感',
  oneLine: '战斗前的静默铺垫',
  body: '在大战开始前，用环境细节铺垫紧张感，不要直接写心理独白。',
  intent: '战斗前夕要有紧张感铺垫',
  compiled: {
    fields: { triggers: ['战斗前夕'], emotion_tags: ['紧张'], exclusions: [], technique_tags: ['伏笔'], priority: 50, beat_types: [] },
    echo: '系统的理解：会在出现「战斗前夕」的章节出场；情绪贴合：紧张；不用于：无',
    engineVersion: '4.0.0',
    compiledAt: '2026-07-19T00:00:00.000Z',
  },
}

function cloneCards(): DraftCard[] {
  return [structureCard, personaCard, craftCard].map((c) => ({
    ...c,
    compiled: c.compiled ? { ...c.compiled, fields: { ...c.compiled.fields } } : null,
  }))
}

/** 发布一个「created」来源的真实本机包（复用 pack-publish.test.ts 同款生产链路，非手搭 fixture）。 */
async function publishPack(name = '我的题材包'): Promise<{ id: string; version: string; draftId: string }> {
  const meta = await createPackDraft({
    userDataPath,
    name,
    seed: { cards: cloneCards(), readme: '# 我的题材包\n\n这是一个测试包。', author: '测试作者', description: '一个用于测试的能力包' },
  })
  const result = await publishPackDraft({ userDataPath, agentCorePath, draftId: meta.draftId, version: '1.0.0' })
  if (result.status !== 'ok') throw new Error(`测试夹具发布失败：${JSON.stringify(result)}`)
  return { id: result.summary.id, version: '1.0.0', draftId: meta.draftId }
}

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'pack-local-content-'))
  userDataPath = join(tmp, 'userData')
  agentCorePath = join(tmp, 'agentCore')
})
afterEach(() => rmSync(tmp, { recursive: true, force: true }))

describe('readLocalPackContent · 三种来源可见性', () => {
  test('imported（无 provenance 记录）→ null（审计红线）', async () => {
    const { id, version } = await publishPack()
    // 模拟「导入」：清掉发布留下的 provenance 记录，磁盘上的包文件仍在
    await removePackProvenance(userDataPath, `${id}@${version}`)
    const result = await readLocalPackContent({ userDataPath, id, version })
    expect(result).toBeNull()
  })

  test('created → 返回全部卡正文', async () => {
    const { id, version } = await publishPack()
    const result = await readLocalPackContent({ userDataPath, id, version })
    expect(result?.localSource).toBe('created')
    expect(result?.cards).toHaveLength(3)
    const craftFile = result?.cards.find((c) => c.body.includes('大战开始前'))
    expect(craftFile?.body).toBe(craftCard.body)
    expect(craftFile?.fileName).toBe(`${craftCard.cardId}.md`)
  })

  test('learned-external → 仍返回正文，localSource 标注供 UI「仅本机使用」', async () => {
    const { id, version } = await publishPack()
    await recordPackProvenance(userDataPath, `${id}@${version}`, { source: 'learned-external' })
    const result = await readLocalPackContent({ userDataPath, id, version })
    expect(result?.localSource).toBe('learned-external')
    expect(result?.cards).toHaveLength(3)
  })

  test('id/version 含非法字符 → null（不拼路径穿越）', async () => {
    const result = await readLocalPackContent({ userDataPath, id: '../evil', version: '1.0.0' })
    expect(result).toBeNull()
  })

  test('版本不存在 → null', async () => {
    const { id } = await publishPack()
    const result = await readLocalPackContent({ userDataPath, id, version: '9.9.9' })
    expect(result).toBeNull()
  })

  test('已装包目录内被植入 symlink 卡文件 → null（读取期 TOCTOU 复查，终审 Minor·纵深）', async () => {
    const { id, version } = await publishPack()
    const packDir = join(userPacksDir(userDataPath), packVersionDirName(id, version))
    // 模拟安装后被外部进程篡改：把一张卡文件换成指向包目录之外文件的符号链接。
    const outsideSecret = join(tmp, 'outside-secret.md')
    writeFileSync(outsideSecret, '包目录之外的机密内容', 'utf8')
    const cardFilePath = join(packDir, 'cards', `${craftCard.cardId}.md`)
    unlinkSync(cardFilePath)
    symlinkSync(outsideSecret, cardFilePath, 'file')
    const result = await readLocalPackContent({ userDataPath, id, version })
    expect(result).toBeNull()
  })
})

describe('copyPackToDraft · 权限门', () => {
  test('created 来源可复制，derivedFrom 正确，卡数据完整反填', async () => {
    const { id, version } = await publishPack('我的题材包')
    const meta = await copyPackToDraft({ userDataPath, id, version })
    expect(meta).not.toBeNull()
    expect(meta?.derivedFrom).toBe(`${id}@${version}`)
    expect(meta?.name).toBe('我的题材包（复制）')

    const draft = await getPackDraft({ userDataPath, draftId: meta!.draftId })
    expect(draft?.cards).toHaveLength(3)
    expect(draft?.readme).toContain('我的题材包')

    const craft = draft?.cards.find((c) => c.type === 'craft')
    expect(craft?.body).toBe(craftCard.body)
    expect(craft?.intent).toBe('')
    expect(craft?.compiled?.fields).toEqual({
      triggers: ['战斗前夕'], emotion_tags: ['紧张'], exclusions: [], technique_tags: ['伏笔'], priority: 50, beat_types: [],
    })
    expect(craft?.compiled?.echo).toBe(craftCard.compiled?.echo)

    const persona = draft?.cards.find((c) => c.type === 'persona')
    expect(persona?.name).toBe('气质卡')
    expect(persona?.compiled?.fields).toEqual({ keywords: ['热血', '轻松'] })

    const structure = draft?.cards.find((c) => c.type === 'structure')
    expect(structure?.oneLine).toBe('三章内抛出核心冲突')
    expect(structure?.compiled?.fields).toEqual({ dimension: 'user-defined', stage: 'stage-1' })
  })

  test('learned-own 来源可复制', async () => {
    const { id, version } = await publishPack('学自己的书')
    await recordPackProvenance(userDataPath, `${id}@${version}`, { source: 'learned-own' })
    const meta = await copyPackToDraft({ userDataPath, id, version })
    expect(meta).not.toBeNull()
  })

  test('learned-external 来源拒绝复制（堵洗掉仅本机标记的通道）', async () => {
    const { id, version } = await publishPack('学别人的书')
    await recordPackProvenance(userDataPath, `${id}@${version}`, { source: 'learned-external' })
    const meta = await copyPackToDraft({ userDataPath, id, version })
    expect(meta).toBeNull()
  })

  test('imported（无 provenance）拒绝复制', async () => {
    const { id, version } = await publishPack()
    await removePackProvenance(userDataPath, `${id}@${version}`)
    const meta = await copyPackToDraft({ userDataPath, id, version })
    expect(meta).toBeNull()
  })

  test('已装包目录内被植入 symlink → 拒绝复制（读取期 TOCTOU 复查，终审 Minor·纵深）', async () => {
    const { id, version } = await publishPack()
    const packDir = join(userPacksDir(userDataPath), packVersionDirName(id, version))
    const outsideSecret = join(tmp, 'outside-secret.md')
    writeFileSync(outsideSecret, '包目录之外的机密内容', 'utf8')
    const cardFilePath = join(packDir, 'cards', `${craftCard.cardId}.md`)
    unlinkSync(cardFilePath)
    symlinkSync(outsideSecret, cardFilePath, 'file')
    const meta = await copyPackToDraft({ userDataPath, id, version })
    expect(meta).toBeNull()
  })

  test('拒绝复制不产生任何新草稿（草稿库存不变）', async () => {
    const { id, version } = await publishPack()
    await recordPackProvenance(userDataPath, `${id}@${version}`, { source: 'learned-external' })
    const before = await readPackProvenance(userDataPath)
    await copyPackToDraft({ userDataPath, id, version })
    const after = await readPackProvenance(userDataPath)
    expect(after).toEqual(before)
  })
})
