// UpdateReadyBanner 真实 DOM 挂载测试。
//
// 为什么不用 GlobalRegistrator：本仓同进程 GlobalRegistrator 安全共存上限=4，已被既有 4 个文件
// （ChapterManuscriptView.interactions / StateChangesLedger / AgentThreadView.interactions /
// BookVoiceAnchors）用满，追加第 5 个会炸既有用例。改走 UpdateBadgeDot.test.tsx /
// WizardView.mount.test.tsx 的先例：手动把 happy-dom 的 Window/Document 挂到 globalThis（保存原
// 值、afterAll 恢复，不经 GlobalRegistrator、不动它的内部状态）。同理不用 `@testing-library/dom`
// 的 `screen`（进程级单例，会被首个 import 者焊死），查询一律走 container.querySelector；
// 点击一律走 fireEvent.click（接受显式元素，不依赖全局 document 绑定）。
//
// 与先例同款的模块加载纪律：全局挂载必须发生在 @testing-library/react 等模块被 import 之前，而
// ES import 会提升到模块顶部——所以先同步挂全局，再顶层 await 动态 import。
import { Window } from 'happy-dom'

const happyWindow = new Window()
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalDocumentDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'document')
Object.defineProperty(globalThis, 'window', { configurable: true, value: happyWindow })
Object.defineProperty(globalThis, 'document', { configurable: true, value: happyWindow.document })
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const { afterAll, afterEach, describe, expect, mock, test } = await import('bun:test')
const { act, cleanup, fireEvent, render } = await import('@testing-library/react')
const { UpdateReadyBanner, UpdateReadyBannerView } = await import('./UpdateReadyBanner.tsx')

afterEach(() => {
  cleanup()
})

afterAll(async () => {
  if (originalWindowDescriptor) Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  else Reflect.deleteProperty(globalThis, 'window')
  if (originalDocumentDescriptor) Object.defineProperty(globalThis, 'document', originalDocumentDescriptor)
  else Reflect.deleteProperty(globalThis, 'document')
  await happyWindow.happyDOM.close()
})

describe('UpdateReadyBannerView', () => {
  test('visible 时渲染单行 banner 按钮，文案一字不改', () => {
    const { container } = render(<UpdateReadyBannerView visible onClick={() => undefined} />)
    const button = container.querySelector('[data-update-ready-banner]')
    expect(button).not.toBeNull()
    expect(button?.textContent).toBe('新版本已就绪，点击重启')
    expect(button?.tagName).toBe('BUTTON')
    expect(button?.getAttribute('aria-label')).toBe('新版本已就绪，点击重启')
  })

  test('不 visible 时什么都不渲染', () => {
    const { container } = render(<UpdateReadyBannerView visible={false} onClick={() => undefined} />)
    expect(container.querySelector('[data-update-ready-banner]')).toBeNull()
  })

  test('点击整条触发 onClick', () => {
    const onClick = mock(() => undefined)
    const { container } = render(<UpdateReadyBannerView visible onClick={onClick} />)
    const button = container.querySelector('[data-update-ready-banner]')
    expect(button).not.toBeNull()
    fireEvent.click(button as Element)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  // 回归：曾用 SIDEBAR_ROW_CLASS 自带的 w-full 撑满 sidebar，配合挂载点 inset-x-2 定位
  // 导致右侧内容被裁切；也曾用半透明 hover/背景，在工作台 sidebar 里挡不住底下的章节目录
  // 文字。overlay 形态必须是实心品牌绿 + 阴影，圆角/间距/过渡与 SIDEBAR_ROW_CLASS（菜单行）
  // 一致，但高度/字号/文字色被覆盖成比菜单行更矮小一号的白字（产品定稿），宽度由挂载点
  // 定位决定（不含 w-full）。
  test('overlay 形态用实心品牌绿 + 阴影，圆角/间距与菜单行一致但更矮小、白字，不强撑满宽', () => {
    const { container } = render(<UpdateReadyBannerView visible onClick={() => undefined} variant="overlay" />)
    const button = container.querySelector('[data-update-ready-banner]')
    expect(button?.getAttribute('data-update-ready-banner-variant')).toBe('overlay')
    expect(button?.className).toContain('bg-system-blue')
    expect(button?.className).toContain('text-white')
    expect(button?.className).not.toContain('text-brand-foreground')
    // 浮层任何半透明背景都会让下层章节文字透上来，逐一排除已知的半透明写法。
    expect(button?.className).not.toContain('bg-brand-soft')
    expect(button?.className).not.toContain('bg-brand/')
    expect(button?.className).not.toContain('bg-hover')
    expect(button?.className).not.toContain('bg-active')
    expect(button?.className).not.toContain('bg-surface')
    // hover 只能靠亮度滤镜（不影响透明度），不能靠 hover:bg-*（会露出半透明底）。
    expect(button?.className).toContain('hover:brightness-95')
    expect(button?.className).not.toContain('hover:bg-')
    expect(button?.className).toContain('shadow-[var(--shadow-floating)]')
    // 与 SIDEBAR_ROW_CLASS 共享的圆角/间距/过渡应原样保留。
    expect(button?.className).toContain('flex items-center gap-2 rounded-row px-2 text-left')
    // 高度/字号/宽度被覆盖，tailwind-merge 应保证只剩覆盖后的值。
    expect(button?.className).toContain('h-7')
    expect(button?.className).not.toContain('h-8')
    expect(button?.className).toContain('text-xs')
    expect(button?.className).not.toContain('text-sm')
    expect(button?.className).toContain('w-auto')
    expect(button?.className).not.toContain('w-full')
    // 图标是纯装饰：颜色跟随文字（不单独指定），不能压扁 truncate 的文字，也不能被读屏重复念。
    const icon = button?.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.getAttribute('class')).toContain('shrink-0')
  })

  // titlebar 形态不是浮层，下面没有内容会被压住，但产品要求两种形态都用实心品牌绿更抢眼；
  // 与 overlay 的差异只剩形状：宽度随文字（无 w-full / truncate），右侧不留白。高度/字号
  // 与工作台 overlay 一致（更矮小一号），h-7 也正好与书架页旁边「新建」按钮（size="sm"）齐平。
  test('titlebar 形态是实心品牌绿紧凑 tag，宽度不撑满，高度/字号与新建按钮（size=sm）对齐', () => {
    const { container } = render(<UpdateReadyBannerView visible onClick={() => undefined} variant="titlebar" />)
    const button = container.querySelector('[data-update-ready-banner]')
    expect(button?.getAttribute('data-update-ready-banner-variant')).toBe('titlebar')
    expect(button?.className).toContain('bg-system-blue')
    expect(button?.className).toContain('text-white')
    expect(button?.className).not.toContain('text-brand-foreground')
    expect(button?.className).toContain('hover:brightness-95')
    expect(button?.className).not.toContain('hover:bg-')
    expect(button?.className).toContain('inline-flex')
    expect(button?.className).toContain('h-7')
    expect(button?.className).not.toContain('h-8')
    expect(button?.className).toContain('text-xs')
    expect(button?.className).not.toContain('text-sm')
    expect(button?.className).not.toContain('w-full')
    expect(button?.className).not.toContain('truncate')
    const icon = button?.querySelector('svg')
    expect(icon).not.toBeNull()
    expect(icon?.getAttribute('aria-hidden')).toBe('true')
    expect(icon?.getAttribute('class')).toContain('shrink-0')
  })
})

describe('UpdateReadyBanner', () => {
  // 非 electron 环境下 useUpdater 返回 idle 兜底态 → 不该显示 banner（与 UpdateBadgeDot 同款兜底）。
  test('空闲态不显示', () => {
    const { container } = render(<UpdateReadyBanner />)
    expect(container.querySelector('[data-update-ready-banner]')).toBeNull()
  })

  // 回归：installUpdate() 失败曾经会产生未捕获的 promise rejection（handleClick 只有
  // finally、没有 catch），且 busy 标志会永久卡住导致再点一次也不会重试。这里真实挂 electron
  // mock 让状态变 ready、installUpdate 拒绝，验证两次点击都能落到 installUpdate（busy 复位）
  // 且测试进程本身不会因未处理 rejection 崩掉。
  test('installUpdate 失败不产生未处理 rejection，且不会卡在忙态', async () => {
    let installCalls = 0
    ;(happyWindow as unknown as { electron: unknown }).electron = {
      getUpdaterState: () =>
        Promise.resolve({ status: 'ready', currentVersion: '0.1.0', availableVersion: '0.2.0', percent: 100, manual: false }),
      onUpdaterStateChanged: () => () => {},
      installUpdate: () => {
        installCalls += 1
        return Promise.reject(new Error('quitAndInstall failed'))
      },
    }

    let container!: HTMLElement
    await act(async () => {
      ;({ container } = render(<UpdateReadyBanner />))
      await Promise.resolve()
    })

    const button = () => container.querySelector('[data-update-ready-banner]')
    expect(button()).not.toBeNull()

    await act(async () => {
      fireEvent.click(button() as Element)
      await Promise.resolve()
    })
    await act(async () => {
      fireEvent.click(button() as Element)
      await Promise.resolve()
    })

    expect(installCalls).toBe(2)
    Reflect.deleteProperty(happyWindow as unknown as Record<string, unknown>, 'electron')
  })
})
