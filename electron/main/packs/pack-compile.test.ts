// electron/main/packs/pack-compile.test.ts
import { describe, expect, test } from 'bun:test'
import { buildCompileCardSource, createPackCompiler, type AuthoringVocab, type PackCompilerDeps } from './pack-compile'
import type { DraftCard, PackDraftMeta } from '@shared/types/capability-pack'
import { POOL_DEFAULT_FIELDS } from '@shared/types/config'

const vocab: AuthoringVocab = {
  emotion_tags: ['紧张', '感动', '爽'],
  technique_tags: ['伏笔', '反转'],
  structure_stages: ['stage-1', 'stage-2', 'stage-opening'],
}

function makeCard(overrides: Partial<DraftCard> = {}): DraftCard {
  return {
    cardId: 'c1',
    type: 'craft',
    name: '技法卡',
    oneLine: '一句话',
    body: '正文',
    intent: '主角遇到危险时出场，带紧张情绪',
    compiled: null,
    ...overrides,
  }
}

/** 内存版假草稿存储：模拟 readDraft/writeDraft（Task 5 真实签名），供测试观察落盘结果。 */
function fakeStore(initialCards: DraftCard[] = [makeCard()]) {
  let cards = initialCards
  const meta: PackDraftMeta = {
    draftId: 'd1',
    name: '测试草稿',
    author: '',
    description: '',
    lastPublishedVersion: null,
    derivedFrom: null,
    updatedAt: '2026-07-20T00:00:00.000Z',
  }
  return {
    getCards: () => cards,
    readDraft: async (_input: { userDataPath: string; draftId: string }) => ({ meta, cards, readme: '' }),
    writeDraft: async (input: { userDataPath: string; draftId: string; patch: { cards?: DraftCard[] } }) => {
      if (input.patch.cards) cards = input.patch.cards
    },
  }
}

function fakeDeps(
  overrides: Partial<PackCompilerDeps> = {},
  store: ReturnType<typeof fakeStore> = fakeStore(),
): { deps: PackCompilerDeps; store: ReturnType<typeof fakeStore> } {
  const deps: PackCompilerDeps = {
    readConfig: async () =>
      ({
        ...POOL_DEFAULT_FIELDS,
        apiKeyMetadata: {},
      }) as any,
    getApiKey: async () => 'sk-test',
    getVocab: async () => vocab,
    readDraft: store.readDraft as unknown as PackCompilerDeps['readDraft'],
    writeDraft: store.writeDraft as unknown as PackCompilerDeps['writeDraft'],
    readEngineVersion: () => '4.0.999',
    createClient: () => ({
      messages: {
        create: async () => ({
          content: [{ type: 'text', text: JSON.stringify({ triggers: ['危险'], emotion_tags: ['紧张'], exclusions: [], technique_tags: [] }) }],
        }),
      },
    }),
    ...overrides,
  }
  return { deps, store }
}

describe('createPackCompiler.compileCard — craft 卡', () => {
  test('假 client 返回合法 JSON → compiled 落 draft 且 echo 含触发词', async () => {
    const { deps, store } = fakeDeps()
    const compiler = createPackCompiler(deps)
    const result = await compiler.compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.compiled.fields).toEqual({
      triggers: ['危险'],
      emotion_tags: ['紧张'],
      exclusions: [],
      technique_tags: [],
      priority: 50,
      beat_types: [],
    })
    expect(result.compiled.echo).toContain('危险')
    expect(result.compiled.engineVersion).toBe('4.0.999')
    expect(typeof result.compiled.compiledAt).toBe('string')

    const persisted = store.getCards().find((c) => c.cardId === 'c1')
    expect(persisted?.compiled).toEqual(result.compiled)
  })

  test('假 client 两次返回非法 JSON（enum 越界）→ status error 且 draft.compiled 保持 null', async () => {
    let calls = 0
    const { deps, store } = fakeDeps({
      createClient: () => ({
        messages: {
          create: async () => {
            calls += 1
            return {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ triggers: ['x'], emotion_tags: ['不存在的情绪'], exclusions: [], technique_tags: [] }),
                },
              ],
            }
          },
        },
      }),
    })
    const compiler = createPackCompiler(deps)
    const result = await compiler.compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })

    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.message.length).toBeGreaterThan(0)
    expect(calls).toBe(2) // 首次 + 重试 1 次
    expect(store.getCards().find((c) => c.cardId === 'c1')?.compiled).toBeNull()
  })

  test('假 client 两次返回缺字段 JSON → status error 且 draft.compiled 保持 null', async () => {
    let calls = 0
    const { deps, store } = fakeDeps({
      createClient: () => ({
        messages: {
          create: async () => {
            calls += 1
            return { content: [{ type: 'text', text: JSON.stringify({ triggers: ['x'] }) }] }
          },
        },
      }),
    })
    const compiler = createPackCompiler(deps)
    const result = await compiler.compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })

    expect(result.status).toBe('error')
    expect(calls).toBe(2)
    expect(store.getCards().find((c) => c.cardId === 'c1')?.compiled).toBeNull()
  })

  test('首次非法、重试合法 → status ok（重试 1 次生效）', async () => {
    let calls = 0
    const { deps } = fakeDeps({
      createClient: () => ({
        messages: {
          create: async () => {
            calls += 1
            if (calls === 1) return { content: [{ type: 'text', text: '不是 JSON' }] }
            return {
              content: [{ type: 'text', text: JSON.stringify({ triggers: ['危险'], emotion_tags: [], exclusions: [], technique_tags: [] }) }],
            }
          },
        },
      }),
    })
    const compiler = createPackCompiler(deps)
    const result = await compiler.compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })
    expect(result.status).toBe('ok')
    expect(calls).toBe(2)
  })

  test('LLM 输出带 ```json 围栏 → 正常剥离解析', async () => {
    const { deps } = fakeDeps({
      createClient: () => ({
        messages: {
          create: async () => ({
            content: [
              {
                type: 'text',
                text: '```json\n' + JSON.stringify({ triggers: ['危险'], emotion_tags: ['紧张'], exclusions: [], technique_tags: [] }) + '\n```',
              },
            ],
          }),
        },
      }),
    })
    const compiler = createPackCompiler(deps)
    const result = await compiler.compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })
    expect(result.status).toBe('ok')
  })

  test('编译 prompt 输入增强（外审 P1）：user 含意图 + one_line + 正文摘要，[evidence] 摘录不进 prompt', async () => {
    const store = fakeStore([
      makeCard({
        oneLine: '打脸场面先抑后扬',
        body: '[runtime]\n机制名：先抑后扬\n注解：铺垫吃瘪再翻盘\n\n[evidence]\n这句摘录原文不该出现在编译输入里',
      }),
    ])
    let capturedUser = ''
    let capturedSystem = ''
    const { deps } = fakeDeps(
      {
        createClient: () => ({
          messages: {
            create: async (body: any) => {
              capturedUser = body.messages[0].content
              capturedSystem = body.system
              return {
                content: [{ type: 'text', text: JSON.stringify({ triggers: ['危险'], emotion_tags: [], exclusions: [], technique_tags: [] }) }],
              }
            },
          },
        }),
      },
      store,
    )
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })
    expect(result.status).toBe('ok')
    expect(capturedUser).toContain('主角遇到危险时出场，带紧张情绪') // intent 仍是主输入
    expect(capturedUser).toContain('打脸场面先抑后扬') // one_line 进 prompt
    expect(capturedUser).toContain('铺垫吃瘪再翻盘') // 正文摘要进 prompt
    expect(capturedUser).not.toContain('这句摘录原文不该出现在编译输入里') // [evidence] 段被剥离
    // 字面触发词纪律进 system prompt（运行时是章纲文本的字面 includes 匹配）
    expect(capturedSystem).toContain('字面出现')
    expect(capturedSystem).toContain('同义变体')
  })

  test('buildCompileCardSource：正文摘要剥 [evidence] 后截前 400 字；空 one_line/正文的手写卡不受影响', () => {
    const longBody = '正'.repeat(500) + '\n[evidence]\n摘录'
    const source = buildCompileCardSource({ intent: '意图', oneLine: '一句', body: longBody })
    expect(source.bodyDigest.length).toBe(400)
    expect(source.bodyDigest).not.toContain('摘录')
    // 手写卡刚建（正文/一句话都为空）：摘要为空串，prompt 组装侧会过滤空段
    expect(buildCompileCardSource({ intent: '只有意图', oneLine: '', body: '' })).toEqual({
      intent: '只有意图',
      oneLine: '',
      bodyDigest: '',
    })
  })

  test('system prompt 内联词表，供 LLM 选取', async () => {
    let capturedSystem = ''
    const { deps } = fakeDeps({
      createClient: () => ({
        messages: {
          create: async (body: any) => {
            capturedSystem = body.system
            return {
              content: [{ type: 'text', text: JSON.stringify({ triggers: ['危险'], emotion_tags: ['紧张'], exclusions: [], technique_tags: [] }) }],
            }
          },
        },
      }),
    })
    await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })
    expect(capturedSystem).toContain('紧张')
    expect(capturedSystem).toContain('伏笔')
    expect(capturedSystem).toContain('只输出')
  })

  test('重试 prompt 内容级断言：第二次调用携带上次原始输出与失败原因', async () => {
    const requests: { system: string; user: string }[] = []
    let calls = 0
    const { deps } = fakeDeps({
      createClient: () => ({
        messages: {
          create: async (body: any) => {
            calls += 1
            requests.push({ system: body.system, user: body.messages[0].content })
            if (calls === 1) return { content: [{ type: 'text', text: '这不是 JSON，随便写点什么' }] }
            return {
              content: [{ type: 'text', text: JSON.stringify({ triggers: ['危险'], emotion_tags: [], exclusions: [], technique_tags: [] }) }],
            }
          },
        },
      }),
    })
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })
    expect(result.status).toBe('ok')
    expect(requests).toHaveLength(2)
    // 第二次请求的 user 内容必须实打实包含第一次的原始输出 + 校验失败原因，而不只是「调用了两次」
    expect(requests[1].user).toContain('这不是 JSON，随便写点什么')
    expect(requests[1].user).toContain('不是合法 JSON')
    // 第一次请求不应该带重试块（没有「上次输出」这回事）
    expect(requests[0].user).not.toContain('上次输出')
  })

  test('client.messages.create 异常（如 429/网络错）→ error 结果且不抛穿、draft 不动、原始错误不透进 UI 文案', async () => {
    let calls = 0
    const { deps, store } = fakeDeps({
      createClient: () => ({
        messages: {
          create: async () => {
            calls += 1
            throw new Error('429 Too Many Requests')
          },
        },
      }),
    })
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })
    expect(result.status).toBe('error')
    // 通用中文失败提示，不透传原始 error.message（黑话/英文异常信息清理，终审 Minor·文案）；
    // 原始 error 走 console.error 留痕（不在此断言，行为不可观察于返回值）。
    if (result.status === 'error') {
      expect(result.message).not.toContain('429')
      expect(result.message.length).toBeGreaterThan(0)
    }
    expect(calls).toBe(1) // 网络异常 fail-fast，不占验证重试名额
    expect(store.getCards().find((c) => c.cardId === 'c1')?.compiled).toBeNull()
  })

  test('triggers 空数组首次非法、重试补上后合法 → ok', async () => {
    let calls = 0
    const { deps } = fakeDeps({
      createClient: () => ({
        messages: {
          create: async () => {
            calls += 1
            if (calls === 1) return { content: [{ type: 'text', text: JSON.stringify({ triggers: [], emotion_tags: [], exclusions: [], technique_tags: [] }) }] }
            return {
              content: [{ type: 'text', text: JSON.stringify({ triggers: ['危险'], emotion_tags: [], exclusions: [], technique_tags: [] }) }],
            }
          },
        },
      }),
    })
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })
    expect(result.status).toBe('ok')
    expect(calls).toBe(2)
  })

  test('triggers 两次都空数组 → error 且 draft.compiled 保持 null', async () => {
    let calls = 0
    const { deps, store } = fakeDeps({
      createClient: () => ({
        messages: {
          create: async () => {
            calls += 1
            return { content: [{ type: 'text', text: JSON.stringify({ triggers: [], emotion_tags: [], exclusions: [], technique_tags: [] }) }] }
          },
        },
      }),
    })
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })
    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.message).toContain('触发词不能为空')
    expect(calls).toBe(2)
    expect(store.getCards().find((c) => c.cardId === 'c1')?.compiled).toBeNull()
  })
})

describe('createPackCompiler.compileCard — persona 卡', () => {
  test('合法 JSON → fields.keywords 落 draft，echo 含气质关键词', async () => {
    const store = fakeStore([makeCard({ type: 'persona', intent: '适合古风言情读者' })])
    const { deps } = fakeDeps(
      {
        createClient: () => ({
          messages: { create: async () => ({ content: [{ type: 'text', text: JSON.stringify({ keywords: ['古风', '言情'] }) }] }) },
        }),
      },
      store,
    )
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.compiled.fields).toEqual({ keywords: ['古风', '言情'] })
    expect(result.compiled.echo).toContain('古风')
    expect(result.compiled.echo).toContain('言情')
  })

  test('keywords 空数组首次非法、重试补上后合法 → ok', async () => {
    const store = fakeStore([makeCard({ type: 'persona', intent: '适合古风言情读者' })])
    let calls = 0
    const { deps } = fakeDeps(
      {
        createClient: () => ({
          messages: {
            create: async () => {
              calls += 1
              if (calls === 1) return { content: [{ type: 'text', text: JSON.stringify({ keywords: [] }) }] }
              return { content: [{ type: 'text', text: JSON.stringify({ keywords: ['古风'] }) }] }
            },
          },
        }),
      },
      store,
    )
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })
    expect(result.status).toBe('ok')
    expect(calls).toBe(2)
  })

  test('keywords 两次都空数组 → error 且 draft.compiled 保持 null', async () => {
    const store = fakeStore([makeCard({ type: 'persona', intent: '适合古风言情读者' })])
    let calls = 0
    const { deps } = fakeDeps(
      {
        createClient: () => ({
          messages: {
            create: async () => {
              calls += 1
              return { content: [{ type: 'text', text: JSON.stringify({ keywords: [] }) }] }
            },
          },
        }),
      },
      store,
    )
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })
    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.message).toContain('关键词不能为空')
    expect(calls).toBe(2)
    expect(store.getCards().find((c) => c.cardId === 'c1')?.compiled).toBeNull()
  })
})

describe('createPackCompiler.compileCard — structure 卡', () => {
  test('零 LLM 调用：直接产出 fields+echo', async () => {
    const store = fakeStore([makeCard({ cardId: 'c2', type: 'structure', intent: 'stage-opening' })])
    let clientCreated = 0
    let calls = 0
    const { deps } = fakeDeps(
      {
        createClient: () => {
          clientCreated += 1
          return { messages: { create: async () => { calls += 1; throw new Error('structure 卡不应调用 LLM') } } }
        },
      },
      store,
    )
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c2' })

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') throw new Error('unreachable')
    expect(result.compiled.fields).toEqual({ stage: 'stage-opening', dimension: 'user-defined' })
    expect(result.compiled.echo).toContain('开局设计')
    expect(clientCreated).toBe(0)
    expect(calls).toBe(0)

    const persisted = store.getCards().find((c) => c.cardId === 'c2')
    expect(persisted?.compiled).toEqual(result.compiled)
  })

  test('非法 stage 值 → status error（不调用 LLM）', async () => {
    const store = fakeStore([makeCard({ cardId: 'c2', type: 'structure', intent: '不是合法阶段' })])
    let calls = 0
    const { deps } = fakeDeps(
      { createClient: () => ({ messages: { create: async () => { calls += 1; return { content: [] } } } }) },
      store,
    )
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c2' })
    expect(result.status).toBe('error')
    expect(calls).toBe(0)
  })
})

describe('createPackCompiler.compileCard — 改 intent 重编译', () => {
  test('改 intent 后再次 compile 覆盖旧 compiled', async () => {
    const store = fakeStore()
    let responseText = JSON.stringify({ triggers: ['危险'], emotion_tags: ['紧张'], exclusions: [], technique_tags: [] })
    const { deps } = fakeDeps(
      {
        createClient: () => ({ messages: { create: async () => ({ content: [{ type: 'text', text: responseText }] }) } }),
      },
      store,
    )
    const compiler = createPackCompiler(deps)

    const first = await compiler.compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })
    expect(first.status).toBe('ok')

    // 模拟作者改写意图（渲染端会先把新 intent 存回 draft，再触发 compile）
    const patchedCards = store.getCards().map((c) => (c.cardId === 'c1' ? { ...c, intent: '主角逃跑时出场' } : c))
    await store.writeDraft({ userDataPath: '/u', draftId: 'd1', patch: { cards: patchedCards } })
    responseText = JSON.stringify({ triggers: ['逃跑'], emotion_tags: [], exclusions: [], technique_tags: [] })

    const second = await compiler.compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })
    expect(second.status).toBe('ok')
    if (second.status !== 'ok' || first.status !== 'ok') throw new Error('unreachable')
    expect(second.compiled.fields.triggers).toEqual(['逃跑'])
    expect(second.compiled).not.toEqual(first.compiled)

    const persisted = store.getCards().find((c) => c.cardId === 'c1')
    expect(persisted?.compiled).toEqual(second.compiled)
  })
})

describe('createPackCompiler.compileCard — 并发编辑竞态（写之前须重读盘上最新草稿）', () => {
  test('LLM 往返期间用户改了另一张卡（卡 B 改名）→ 编译完成后 B 的新名字存活，A 的 compiled 正确落上', async () => {
    const store = fakeStore([makeCard({ cardId: 'a', name: 'A卡', intent: '主角遇到危险时出场，带紧张情绪' }), makeCard({ cardId: 'b', name: 'B卡' })])
    const { deps } = fakeDeps(
      {
        createClient: () => ({
          messages: {
            create: async () => {
              // 模拟并发编辑：在 LLM 往返期间（compileCard 已经读过一次旧 draft.cards 之后），
              // 渲染端把卡 B 改名并落盘——这次写入必须存活，不能被 A 编译完成时的写回覆盖。
              const patched = store.getCards().map((c) => (c.cardId === 'b' ? { ...c, name: 'B卡新名字' } : c))
              await store.writeDraft({ userDataPath: '/u', draftId: 'd1', patch: { cards: patched } })
              return {
                content: [{ type: 'text', text: JSON.stringify({ triggers: ['危险'], emotion_tags: ['紧张'], exclusions: [], technique_tags: [] }) }],
              }
            },
          },
        }),
      },
      store,
    )
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'a' })

    expect(result.status).toBe('ok')
    const cardA = store.getCards().find((c) => c.cardId === 'a')
    const cardB = store.getCards().find((c) => c.cardId === 'b')
    // 现实现（写之前不重读）会红：整数组覆盖会把 B 的改名冲掉，本断言应失败。
    expect(cardB?.name).toBe('B卡新名字')
    expect(cardA?.compiled).toEqual(result.status === 'ok' ? result.compiled : null)
  })

  test('LLM 往返期间目标卡被删 → 不写、返回「卡已被删除」', async () => {
    const store = fakeStore([makeCard({ cardId: 'a', intent: '主角遇到危险时出场，带紧张情绪' })])
    const { deps } = fakeDeps(
      {
        createClient: () => ({
          messages: {
            create: async () => {
              // 模拟并发编辑：LLM 还没返回时，卡 a 已经被删除。
              await store.writeDraft({ userDataPath: '/u', draftId: 'd1', patch: { cards: [] } })
              return {
                content: [{ type: 'text', text: JSON.stringify({ triggers: ['危险'], emotion_tags: ['紧张'], exclusions: [], technique_tags: [] }) }],
              }
            },
          },
        }),
      },
      store,
    )
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'a' })

    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.message).toBe('卡已被删除。')
    expect(store.getCards()).toEqual([])
  })
})

describe('createPackCompiler.compileCard — 边界', () => {
  test('draft 不存在 → error', async () => {
    const { deps } = fakeDeps({ readDraft: (async () => null) as unknown as PackCompilerDeps['readDraft'] })
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'missing', cardId: 'c1' })
    expect(result.status).toBe('error')
  })

  test('card 不存在 → error', async () => {
    const { deps } = fakeDeps()
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'nope' })
    expect(result.status).toBe('error')
  })

  test('无 API Key → error 且不动 draft', async () => {
    const { deps, store } = fakeDeps({ getApiKey: async () => null })
    const result = await createPackCompiler(deps).compileCard({ userDataPath: '/u', draftId: 'd1', cardId: 'c1' })
    expect(result.status).toBe('error')
    expect(store.getCards().find((c) => c.cardId === 'c1')?.compiled).toBeNull()
  })
})
