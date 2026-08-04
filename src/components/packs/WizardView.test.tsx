// 作家向导视图测试（刀5 Task 6）。全部走 SSR（`renderToStaticMarkup`）+ 纯函数断言，不注册真实
// DOM：当时本仓库 GlobalRegistrator 安全共存上限 3 个文件已满（刀4 T12 环境知识，详见
// LearnFromBookView.test.tsx 头注——该注释已按 2026-07-29 复测更新，「上限=3」结论已被推翻），
// 故沿用其替代打法——纯展示子组件按 props 出证据，这个打法本身对 zustand v5 SSR 快照问题
// （见下）仍是必要的，不只是为了绕开一个已不存在的文件数上限。会话布局
// 的状态分支从 `WizardSessionView`（只吃 props）出证据：zustand v5 的 `useStore` 在 SSR 走
// `getInitialState` 快照，测试里 `setState` 摆出的状态对 `renderToStaticMarkup` 不可见，
// 直接 SSR 读 store 的容器断言不了分支——props 化是唯一可靠打法。
//
// T5 评审 Minor-1 硬要求在此锁死：取消出口在 preparing / awaiting_user / thinking / saving 全部
// 非终态「至少一处存在且可点」——composer 右侧插槽双态（awaiting_user=发送箭头，其余=停止方块）
// + 会话头部「结束访谈」文字出口（全非终态常驻）。若主进程 send invoke 永不 settle（模型流卡死），
// store 停在 thinking，此时插槽+头部两处均可停；awaiting_user 时插槽被发送占用，头部兜底。
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  WIZARD_COST_LINE,
  WIZARD_GUIDE_NAME,
  WIZARD_INTRO_LINE,
  WIZARD_JOURNEY_LINE,
  WIZARD_PASTE_HINT_TEXT,
  WIZARD_WELCOME_TEXT,
  WizardComposer,
  WizardIntroStep,
  WizardMessageRow,
  WizardPasteHint,
  WizardSessionView,
  WizardStatusBubble,
  WizardEndButton,
  WizardTerminalStep,
  WizardView,
  WizardWelcomeBlock,
  countUncompiledCards,
  countZeroHitCards,
  isLargePaste,
  isOverWizardInputLimit,
  shouldResetStopping,
} from './WizardView'
import type { PackWizardMessage } from '@/lib/pack-wizard-store'
import type { PackWizardCardSummary, PackWizardPhase } from '@shared/types/capability-pack'

/** 会话布局默认 props：单测按分支覆写关心的字段。 */
function renderSession(overrides: Partial<Parameters<typeof WizardSessionView>[0]>): string {
  return renderToStaticMarkup(
    <WizardSessionView
      messages={[]}
      phase="preparing"
      draftId={null}
      cardCount={null}
      error={null}
      stopping={false}
      pasteHintVisible={false}
      onCancel={() => {}}
      onSend={() => {}}
      onLargePaste={() => {}}
      onDismissPasteHint={() => {}}
      onOpenDraft={() => {}}
      onRestart={() => {}}
      {...overrides}
    />,
  )
}

describe('WizardIntroStep · 开场页（空状态规范：插图+标题+正文+一个主按钮）', () => {
  test('插图 + 标题 + 分工句 + 三步旅程行 + 成本句 + 主按钮「开始」', () => {
    const markup = renderToStaticMarkup(<WizardIntroStep onStart={() => {}} />)
    expect(markup).toContain('data-brand-illustration="wizard-journey"')
    expect(markup).toContain('作家向导')
    expect(markup).toContain('把你脑子里的写法聊出来炼成卡——不需要范本书。')
    expect(markup).toContain('聊想法 → 试写你挑 → 炼成你的卡')
    expect(markup).toContain('访谈按聊天计费，比从书学便宜得多。')
    expect(markup).toContain('data-wizard-start-trigger="true"')
    expect(markup).toContain('>开始<')
  })

  test('导出常量与页面渲染一致（防两处漂移）', () => {
    const markup = renderToStaticMarkup(<WizardIntroStep onStart={() => {}} />)
    expect(markup).toContain(WIZARD_INTRO_LINE)
    expect(markup).toContain(WIZARD_JOURNEY_LINE)
    expect(markup).toContain(WIZARD_COST_LINE)
  })
})

describe('WizardWelcomeBlock · 本地欢迎段（确定性，非 store 消息）', () => {
  test('头像 + 「写法向导」名签 + 旅程说明逐字', () => {
    const markup = renderToStaticMarkup(<WizardWelcomeBlock />)
    expect(markup).toContain('data-wizard-welcome="true"')
    expect(markup).toContain('data-wizard-avatar="true"')
    expect(markup).toContain('data-brand-illustration="wizard-guide"')
    expect(markup).toContain(WIZARD_GUIDE_NAME)
    expect(markup).toContain(
      '你好，我是你的写法向导。接下来我们聊几轮天：先聊聊你喜欢的写法和感觉，聊到位了我会试写几段小样让你挑，最后把你认可的写法整理成你自己的能力卡。大概需要几分钟，随时可以停。',
    )
    expect(markup).toContain(WIZARD_WELCOME_TEXT)
  })
})

describe('WizardMessageRow · 作者右 / 向导左（带头像）', () => {
  test('作者消息：右对齐实色气泡，不带头像', () => {
    const markup = renderToStaticMarkup(<WizardMessageRow message={{ role: 'user', text: '我喜欢开局就有冲突' }} />)
    expect(markup).toContain('data-wizard-message="user"')
    expect(markup).toContain('justify-end')
    expect(markup).toContain('bg-foreground')
    expect(markup).toContain('我喜欢开局就有冲突')
    expect(markup).not.toContain('data-wizard-avatar')
  })

  test('向导消息：左对齐描边气泡 + 头像（名签不逐条标，克制）', () => {
    const markup = renderToStaticMarkup(<WizardMessageRow message={{ role: 'assistant', text: '想炼哪方面的写法？' }} />)
    expect(markup).toContain('data-wizard-message="assistant"')
    expect(markup).toContain('justify-start')
    expect(markup).toContain('data-wizard-avatar="true"')
    expect(markup).toContain('想炼哪方面的写法？')
    expect(markup).not.toContain('写法向导')
  })
})

describe('WizardStatusBubble · 进行中指示', () => {
  const CASES: Array<[PackWizardPhase, string]> = [
    ['preparing', '正在准备…'],
    ['thinking', '正在想…'],
    ['saving', '正在整理成卡…'],
  ]

  for (const [phase, text] of CASES) {
    test(`${phase} → 「${text}」+ 头像旁挂（对方正在输入心智）`, () => {
      const markup = renderToStaticMarkup(<WizardStatusBubble phase={phase} />)
      expect(markup).toContain(`data-wizard-status="${phase}"`)
      expect(markup).toContain('data-wizard-avatar="true"')
      expect(markup).toContain(text)
    })
  }

  test('awaiting_user（轮到作者）与 null 不渲染指示', () => {
    expect(renderToStaticMarkup(<WizardStatusBubble phase="awaiting_user" />)).toBe('')
    expect(renderToStaticMarkup(<WizardStatusBubble phase={null} />)).toBe('')
  })
})

describe('WizardPasteHint · 贴片段轻提示（文案逐字）', () => {
  test('提示句 + 可关闭按钮', () => {
    const markup = renderToStaticMarkup(<WizardPasteHint onDismiss={() => {}} />)
    expect(markup).toContain('请确认粘贴的是你自己的文字——导出分享时需要你确认拥有分享权利。')
    expect(markup).toContain(WIZARD_PASTE_HINT_TEXT)
    expect(markup).toContain('data-wizard-paste-hint-dismiss="true"')
  })
})

describe('isLargePaste · 轻提示确定性触发阈值（>200 字）', () => {
  test('恰好 200 字不触发，201 字触发', () => {
    expect(isLargePaste('字'.repeat(200))).toBe(false)
    expect(isLargePaste('字'.repeat(201))).toBe(true)
  })

  test('空文本不触发', () => {
    expect(isLargePaste('')).toBe(false)
  })
})

describe('isOverWizardInputLimit · 超限拒发预检（T6 评审 Minor-1，与主进程同一常量拒发不截断）', () => {
  test('恰好 50000 字放行，50001 字超限', () => {
    expect(isOverWizardInputLimit('字'.repeat(50_000))).toBe(false)
    expect(isOverWizardInputLimit('字'.repeat(50_001))).toBe(true)
  })
})

/** composer 默认 props：单测按分支覆写。 */
function renderComposer(overrides: Partial<Parameters<typeof WizardComposer>[0]>): string {
  return renderToStaticMarkup(
    <WizardComposer
      canSend={false}
      stopping={false}
      onSend={() => {}}
      onCancel={() => {}}
      onLargePaste={() => {}}
      {...overrides}
    />,
  )
}

describe('WizardComposer · 右侧单一插槽双态（发送/停止）', () => {
  test('canSend=true 但还没打字：插槽是发送态，按钮禁用（空消息不发）', () => {
    const markup = renderComposer({ canSend: true })
    expect(markup).toContain('data-wizard-send="true"')
    expect(markup).not.toContain('data-wizard-cancel-trigger')
    expect(markup).toContain('disabled=""')
  })

  test('canSend=false（向导在准备/在想/在整理）：插槽换停止方块，可点', () => {
    const markup = renderComposer({ canSend: false })
    expect(markup).not.toContain('data-wizard-send')
    expect(markup).toContain('data-wizard-cancel-trigger="true"')
    expect(markup).toContain('aria-label="停止"')
    expect(markup).not.toContain('disabled=""')
  })

  test('停止插槽 stopping=true：禁用 + 菊花（「正在停止…」由 aria-label 承载）', () => {
    const markup = renderComposer({ canSend: false, stopping: true })
    expect(markup).toContain('data-wizard-cancel-trigger="true"')
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('aria-label="正在停止…"')
  })
})

describe('WizardEndButton · 头部「结束访谈」出口（awaiting_user 时唯一取消入口）', () => {
  test('未点：文案「结束访谈」，可点', () => {
    const markup = renderToStaticMarkup(<WizardEndButton stopping={false} onCancel={() => {}} />)
    expect(markup).toContain('data-wizard-end-trigger="true"')
    expect(markup).toContain('>结束访谈<')
    expect(markup).not.toContain('正在停止')
    expect(markup).not.toContain('disabled=""')
  })

  test('点了（stopping=true）：禁用 + 「正在停止…」', () => {
    const markup = renderToStaticMarkup(<WizardEndButton stopping={true} onCancel={() => {}} />)
    expect(markup).toContain('disabled=""')
    expect(markup).toContain('正在停止…')
    expect(markup).not.toContain('>结束访谈<')
  })
})

describe('shouldResetStopping · 「正在停止…」重置判定（撞车成 done/error 也解除，刀4 同族教训）', () => {
  test('终态三值与 null（reset 后）都重置', () => {
    expect(shouldResetStopping('cancelled')).toBe(true)
    expect(shouldResetStopping('done')).toBe(true)
    expect(shouldResetStopping('error')).toBe(true)
    expect(shouldResetStopping(null)).toBe(true)
  })

  test('进行中不重置——运行区「正在停止…」该继续显示', () => {
    expect(shouldResetStopping('preparing')).toBe(false)
    expect(shouldResetStopping('awaiting_user')).toBe(false)
    expect(shouldResetStopping('thinking')).toBe(false)
    expect(shouldResetStopping('saving')).toBe(false)
  })
})

describe('countZeroHitCards / countUncompiledCards · 完成页警示计数（纯函数）', () => {
  const CARDS: PackWizardCardSummary[] = [
    { name: '零命中卡', type: 'craft', compiled: true, previewHits: 0 },
    { name: '正常卡', type: 'craft', compiled: true, previewHits: 2 },
    { name: '没测出来的卡', type: 'persona', compiled: true, previewHits: null },
    { name: '没编译的卡', type: 'craft', compiled: false, previewHits: null },
    { name: '剧作卡', type: 'structure', compiled: true, previewHits: null },
  ]

  test('previewHits===0 才算零命中；null（structure/预览异常/未编译）不算', () => {
    expect(countZeroHitCards(CARDS)).toBe(1)
    expect(countZeroHitCards(null)).toBe(0)
    expect(countZeroHitCards(undefined)).toBe(0)
  })

  test('compiled=false 计入未编译', () => {
    expect(countUncompiledCards(CARDS)).toBe(1)
    expect(countUncompiledCards(null)).toBe(0)
  })
})

describe('WizardTerminalStep · 四个终态出口（终态无死路，刀4 完成页教训）', () => {
  test('done + draftId：头像 + 「为你炼出 N 张卡」+ 主按钮「查看草稿」+ 次级「再来一次」', () => {
    const markup = renderToStaticMarkup(
      <WizardTerminalStep
        phase="done"
        draftId="draft-1"
        cardCount={3}
        error={null}
        onOpenDraft={() => {}}
        onRestart={() => {}}
      />,
    )
    expect(markup).toContain('data-wizard-done-step="true"')
    expect(markup).toContain('data-wizard-avatar="true"')
    expect(markup).toContain('为你炼出 3 张卡')
    expect(markup).toContain('data-wizard-open-draft-trigger="true"')
    expect(markup).toContain('>查看草稿<')
    expect(markup).toContain('data-wizard-restart-trigger="true"')
    expect(markup).toContain('>再来一次<')
  })

  test('done 全好（卡全编译成功且有命中）：主口径外零警示行', () => {
    const markup = renderToStaticMarkup(
      <WizardTerminalStep
        phase="done"
        draftId="draft-1"
        cardCount={2}
        cards={[
          { name: 'A', type: 'craft', compiled: true, previewHits: 3 },
          { name: 'B', type: 'structure', compiled: true, previewHits: null },
        ]}
        droppedCount={0}
        error={null}
        onOpenDraft={() => {}}
        onRestart={() => {}}
      />,
    )
    expect(markup).toContain('为你炼出 2 张卡')
    expect(markup).not.toContain('data-wizard-zero-hit-warning')
    expect(markup).not.toContain('data-wizard-uncompiled-warning')
    expect(markup).not.toContain('data-wizard-dropped-note')
  })

  test('done 有零命中卡：克制警示行 + 指路草稿编辑器（对齐刀3 §5.3 无出场警示）', () => {
    const markup = renderToStaticMarkup(
      <WizardTerminalStep
        phase="done"
        draftId="draft-1"
        cardCount={3}
        cards={[
          { name: 'A', type: 'craft', compiled: true, previewHits: 0 },
          { name: 'B', type: 'persona', compiled: true, previewHits: 0 },
          { name: 'C', type: 'craft', compiled: true, previewHits: 2 },
        ]}
        droppedCount={0}
        error={null}
        onOpenDraft={() => {}}
        onRestart={() => {}}
      />,
    )
    expect(markup).toContain('data-wizard-zero-hit-warning="true"')
    expect(markup).toContain('其中 2 张在典型场景里暂时不会出场——去草稿里把「什么时候用」说得更具体。')
    expect(markup).not.toContain('data-wizard-uncompiled-warning')
    // 主口径与出口保留（警示不换页、不夺路）
    expect(markup).toContain('为你炼出 3 张卡')
    expect(markup).toContain('>查看草稿<')
  })

  test('done 有未编译卡 + 有被放弃卡：各自如实一行', () => {
    const markup = renderToStaticMarkup(
      <WizardTerminalStep
        phase="done"
        draftId="draft-1"
        cardCount={2}
        cards={[
          { name: 'A', type: 'craft', compiled: false, previewHits: null },
          { name: 'B', type: 'craft', compiled: true, previewHits: 1 },
        ]}
        droppedCount={1}
        error={null}
        onOpenDraft={() => {}}
        onRestart={() => {}}
      />,
    )
    expect(markup).toContain('data-wizard-uncompiled-warning="true"')
    expect(markup).toContain('1 张卡还没编译成功，发布前需要联网重试。')
    expect(markup).toContain('data-wizard-dropped-note="true"')
    expect(markup).toContain('有 1 张卡因格式不完整被放弃。')
    expect(markup).not.toContain('data-wizard-zero-hit-warning')
  })

  test('done 无摘要（旧事件形态/快照缺省）：完成页照常，零警示行——不因缺数据误报', () => {
    const markup = renderToStaticMarkup(
      <WizardTerminalStep
        phase="done"
        draftId="draft-1"
        cardCount={2}
        cards={null}
        droppedCount={null}
        error={null}
        onOpenDraft={() => {}}
        onRestart={() => {}}
      />,
    )
    expect(markup).toContain('为你炼出 2 张卡')
    expect(markup).not.toContain('data-wizard-zero-hit-warning')
    expect(markup).not.toContain('data-wizard-uncompiled-warning')
    expect(markup).not.toContain('data-wizard-dropped-note')
  })

  test('done + draftId=null（空卡，T5 上游契约）：说明没聊出可炼的写法 + 提示往上看最后一条消息 + 「再来一次」', () => {
    const markup = renderToStaticMarkup(
      <WizardTerminalStep
        phase="done"
        draftId={null}
        cardCount={0}
        error={null}
        onOpenDraft={() => {}}
        onRestart={() => {}}
      />,
    )
    expect(markup).toContain('data-wizard-ended-step="done"')
    expect(markup).toContain('这次没聊出可炼的写法——为什么没聊出来，向导在上面最后一条消息里说了。')
    expect(markup).toContain('>再来一次<')
    expect(markup).not.toContain('查看草稿')
  })

  test('error：人话原因 + 「再来一次」', () => {
    const markup = renderToStaticMarkup(
      <WizardTerminalStep
        phase="error"
        draftId={null}
        cardCount={null}
        error="模型服务超时"
        onOpenDraft={() => {}}
        onRestart={() => {}}
      />,
    )
    expect(markup).toContain('data-wizard-ended-step="error"')
    expect(markup).toContain('模型服务超时')
    expect(markup).toContain('>再来一次<')
  })

  test('cancelled：「访谈已停止。」+ 「再来一次」', () => {
    const markup = renderToStaticMarkup(
      <WizardTerminalStep
        phase="cancelled"
        draftId={null}
        cardCount={null}
        error={null}
        onOpenDraft={() => {}}
        onRestart={() => {}}
      />,
    )
    expect(markup).toContain('data-wizard-ended-step="cancelled"')
    expect(markup).toContain('访谈已停止。')
    expect(markup).toContain('>再来一次<')
  })
})

describe('WizardView 容器 · 进入水合（会话可恢复）', () => {
  test('store 无会话的首帧（水合未完成）：空白占位——不闪开场页，恢复语义由挂载水合决定', () => {
    // SSR 不跑 effect，等价于「挂载首帧、快照还没落地」：此时渲染任何具体页面都是抢答——
    // 主进程可能有会话（重载场景），闪一帧开场页再跳成对话视图是视觉跳变，故空白占位。
    // 开场页/对话视图/终态页的完整证据已由 WizardIntroStep / WizardSessionView 各自的用例出。
    const markup = renderToStaticMarkup(<WizardView onOpenDraft={() => {}} />)
    expect(markup).toBe('')
  })
})

describe('WizardSessionView · phase 分支（会话布局按 props 出证据）', () => {
  const NON_TERMINAL: PackWizardPhase[] = ['preparing', 'awaiting_user', 'thinking', 'saving']
  for (const phase of NON_TERMINAL) {
    test(`非终态 ${phase}：取消出口至少一处存在且可点（T5 评审 Minor-1 逃生链）+ 输入区在场`, () => {
      const markup = renderSession({ phase })
      // 插槽停止态（aria-label="停止" 即未禁用）或头部「结束访谈」（>结束访谈< 即未禁用，
      // stopping 是唯一禁用路径且会换文案）——至少一处
      const slotStopClickable =
        markup.includes('data-wizard-cancel-trigger="true"') && markup.includes('aria-label="停止"')
      const headerEndClickable = markup.includes('data-wizard-end-trigger="true"') && markup.includes('>结束访谈<')
      expect(slotStopClickable || headerEndClickable).toBe(true)
      // 头部「结束访谈」全非终态常驻
      expect(headerEndClickable).toBe(true)
      // 插槽双态：awaiting_user=发送箭头（无插槽停止），其余=停止方块（无发送按钮）
      if (phase === 'awaiting_user') {
        expect(markup).toContain('data-wizard-send="true"')
        expect(markup).not.toContain('data-wizard-cancel-trigger')
      } else {
        expect(slotStopClickable).toBe(true)
        expect(markup).not.toContain('data-wizard-send')
      }
      expect(markup).toContain('data-wizard-composer="true"')
    })
  }

  test('钉底布局：消息区是内部滚动容器（flex-1 + overflow-y-auto），composer 固定其下', () => {
    const markup = renderSession({ phase: 'awaiting_user' })
    const conversation = markup.slice(markup.indexOf('data-wizard-conversation') - 200, markup.indexOf('data-wizard-conversation'))
    expect(conversation).toContain('flex-1')
    expect(conversation).toContain('overflow-y-auto')
    // composer 在消息区之后（DOM 顺序钉底）
    expect(markup.indexOf('data-wizard-composer')).toBeGreaterThan(markup.indexOf('data-wizard-conversation'))
  })

  test('awaiting_user：消息流按角色渲染，欢迎块恒在消息流顶部（在场即显示，不依赖 store）', () => {
    const messages: PackWizardMessage[] = [
      { role: 'assistant', text: '想炼哪方面的写法？' },
      { role: 'user', text: '打脸场面的铺排' },
    ]
    const markup = renderSession({ phase: 'awaiting_user', messages })
    expect(markup).toContain('data-wizard-message="assistant"')
    expect(markup).toContain('data-wizard-message="user"')
    expect(markup).toContain('想炼哪方面的写法？')
    expect(markup).toContain('打脸场面的铺排')
    expect(markup).toContain('data-wizard-welcome="true"')
    expect(markup.indexOf('data-wizard-welcome')).toBeLessThan(markup.indexOf('data-wizard-message="assistant"'))
  })

  test('欢迎块在终态也保留（会话回看完整）——头像与名签随之在场', () => {
    const markup = renderSession({ phase: 'cancelled' })
    expect(markup).toContain('data-wizard-welcome="true"')
    expect(markup).toContain(WIZARD_GUIDE_NAME)
  })

  test('saving：指示「正在整理成卡…」', () => {
    expect(renderSession({ phase: 'saving' })).toContain('正在整理成卡…')
  })

  test('轻提示可见时渲染在输入区上方，终态不渲染输入区也不渲染轻提示', () => {
    expect(renderSession({ phase: 'awaiting_user', pasteHintVisible: true })).toContain('data-wizard-paste-hint="true"')
    expect(renderSession({ phase: 'cancelled', pasteHintVisible: true })).not.toContain('data-wizard-paste-hint')
  })

  test('done 终态：不渲染取消出口（插槽/头部）与输入区，渲染终态页', () => {
    const markup = renderSession({ phase: 'done', draftId: 'draft-1', cardCount: 2 })
    expect(markup).not.toContain('data-wizard-cancel-trigger')
    expect(markup).not.toContain('data-wizard-end-trigger')
    expect(markup).not.toContain('data-wizard-composer')
    expect(markup).toContain('data-wizard-done-step="true"')
    expect(markup).toContain('为你炼出 2 张卡')
  })

  test('cancelled 终态：终态页 + 「再来一次」出口', () => {
    const markup = renderSession({ phase: 'cancelled' })
    expect(markup).toContain('data-wizard-ended-step="cancelled"')
    expect(markup).toContain('>再来一次<')
  })
})
