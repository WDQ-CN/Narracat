import { describe, expect, test } from 'bun:test'
import {
  createInitialUpdaterState,
  nextUpdaterState,
  resolveUpdaterStateForRead,
  shouldRunUpdater,
  UPDATE_CHECK_DELAY_MS,
  UPDATE_CHECK_INTERVAL_MS,
} from './updater.ts'

const base = createInitialUpdaterState('0.1.1871')

/** 「已下载完、待重启」的状态，多条用例共用。 */
function readyState() {
  const downloading = nextUpdaterState(base, { type: 'update-available', version: '0.1.1880' })
  return nextUpdaterState(downloading, { type: 'update-downloaded', version: '0.1.1880' })
}

describe('createInitialUpdaterState', () => {
  test('初始为 idle、无新版本、进度 0、非手动', () => {
    expect(base).toEqual({
      status: 'idle',
      currentVersion: '0.1.1871',
      availableVersion: null,
      percent: 0,
      manual: false,
    })
  })
})

describe('nextUpdaterState', () => {
  test('check-started 进入 checking 并记住手动标记', () => {
    const next = nextUpdaterState(base, { type: 'check-started', manual: true })
    expect(next.status).toBe('checking')
    expect(next.manual).toBe(true)
  })

  test('update-available 直接进 downloading（autoDownload，不询问用户）', () => {
    const next = nextUpdaterState(base, { type: 'update-available', version: '0.1.1880' })
    expect(next.status).toBe('downloading')
    expect(next.availableVersion).toBe('0.1.1880')
    expect(next.percent).toBe(0)
  })

  test('update-not-available 回 idle 且清空新版本号', () => {
    const checking = nextUpdaterState(base, { type: 'check-started', manual: true })
    const next = nextUpdaterState(checking, { type: 'update-not-available' })
    expect(next.status).toBe('idle')
    expect(next.availableVersion).toBeNull()
  })

  test('download-progress 取整并夹在 0-100', () => {
    const downloading = nextUpdaterState(base, { type: 'update-available', version: '0.1.1880' })
    expect(nextUpdaterState(downloading, { type: 'download-progress', percent: 42.7 }).percent).toBe(42)
    expect(nextUpdaterState(downloading, { type: 'download-progress', percent: -5 }).percent).toBe(0)
    expect(nextUpdaterState(downloading, { type: 'download-progress', percent: 250 }).percent).toBe(100)
  })

  test('update-downloaded 进 ready、进度置满', () => {
    const downloading = nextUpdaterState(base, { type: 'update-available', version: '0.1.1880' })
    const next = nextUpdaterState(downloading, { type: 'update-downloaded', version: '0.1.1880' })
    expect(next.status).toBe('ready')
    expect(next.percent).toBe(100)
    expect(next.availableVersion).toBe('0.1.1880')
  })

  // ready 是粘性状态：更新已下载完、只等用户重启。每 4h 的例行检查仍会打进来，
  // 若不守住，用户看到的「已就绪，重启生效」会周期性消失又出现（假状态闪烁）。
  // 三条一起测，因为只堵 error 一种是不够的——轮询首先发的是 check-started。
  test('ready 状态下收到 error 仍保持 ready', () => {
    expect(nextUpdaterState(readyState(), { type: 'error' })).toEqual(readyState())
  })

  test('ready 状态下收到 check-started 仍保持 ready', () => {
    expect(nextUpdaterState(readyState(), { type: 'check-started', manual: false })).toEqual(readyState())
  })

  test('ready 状态下再次收到 update-available 不回退进度', () => {
    // app 未重启 → currentVersion 仍是旧版 → 轮询必然再次判定「有新版可用」。
    // 不守住就会把 percent 打回 0、状态退回 downloading。
    expect(nextUpdaterState(readyState(), { type: 'update-available', version: '0.1.1880' })).toEqual(readyState())
  })

  test('非 ready 状态下 error 进 error 且保留手动标记', () => {
    const checking = nextUpdaterState(base, { type: 'check-started', manual: true })
    const next = nextUpdaterState(checking, { type: 'error' })
    expect(next.status).toBe('error')
    expect(next.manual).toBe(true)
  })
})

describe('shouldRunUpdater', () => {
  test('打包态的 macOS 启用', () => {
    expect(shouldRunUpdater({ isPackaged: true, platform: 'darwin' })).toBe(true)
  })

  test('打包态的 Windows 也启用（Windows 战役落位即生效，无需返工）', () => {
    expect(shouldRunUpdater({ isPackaged: true, platform: 'win32' })).toBe(true)
  })

  test('开发态一律不启用', () => {
    expect(shouldRunUpdater({ isPackaged: false, platform: 'darwin' })).toBe(false)
  })

  test('未支持平台不启用', () => {
    expect(shouldRunUpdater({ isPackaged: true, platform: 'linux' })).toBe(false)
  })
})

describe('resolveUpdaterStateForRead（开发预览开关 §6.1）', () => {
  test('打包态即使开着预览环境变量也原样返回真实 state（生产路径零影响）', () => {
    expect(
      resolveUpdaterStateForRead({ state: base, isPackaged: true, previewReadyEnv: '1' }),
    ).toEqual(base)
  })

  test('非打包态但未设环境变量，原样返回真实 state', () => {
    expect(
      resolveUpdaterStateForRead({ state: base, isPackaged: false, previewReadyEnv: undefined }),
    ).toEqual(base)
  })

  test('非打包态且环境变量非 "1"，原样返回真实 state', () => {
    expect(
      resolveUpdaterStateForRead({ state: base, isPackaged: false, previewReadyEnv: 'true' }),
    ).toEqual(base)
  })

  test('非打包态且环境变量为 "1"，伪装成已就绪供本地预览 banner', () => {
    const next = resolveUpdaterStateForRead({ state: base, isPackaged: false, previewReadyEnv: '1' })
    expect(next.status).toBe('ready')
    expect(next.percent).toBe(100)
    expect(next.currentVersion).toBe(base.currentVersion)
    expect(next.availableVersion).toBe(`${base.currentVersion}-preview`)
  })

  test('真实 state 已带 availableVersion 时保留原版本号，不覆盖成 -preview 后缀', () => {
    const downloaded = nextUpdaterState(
      nextUpdaterState(base, { type: 'update-available', version: '0.1.1880' }),
      { type: 'update-downloaded', version: '0.1.1880' },
    )
    const next = resolveUpdaterStateForRead({ state: downloaded, isPackaged: false, previewReadyEnv: '1' })
    expect(next.availableVersion).toBe('0.1.1880')
  })
})

describe('时序常量', () => {
  test('启动延迟 30s、轮询 4h', () => {
    expect(UPDATE_CHECK_DELAY_MS).toBe(30_000)
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(4 * 60 * 60 * 1000)
  })
})
