import { describe, expect, test } from 'bun:test'
import type { UpdaterState } from '@shared/types/ipc'
import { describeUpdateStatus, shouldShowUpdateBadge } from './updater-view'

const base: UpdaterState = {
  status: 'idle',
  currentVersion: '0.1.1871',
  availableVersion: null,
  percent: 0,
  manual: false,
}

describe('describeUpdateStatus', () => {
  test('空闲显示已是最新、按钮为检查更新', () => {
    expect(describeUpdateStatus(base)).toEqual({ text: '已是最新', action: 'check', actionLabel: '检查更新' })
  })

  test('检查中禁用按钮', () => {
    expect(describeUpdateStatus({ ...base, status: 'checking' })).toEqual({
      text: '正在检查…',
      action: 'none',
      actionLabel: '检查更新',
    })
  })

  test('下载中显示百分比', () => {
    expect(describeUpdateStatus({ ...base, status: 'downloading', percent: 42 })).toEqual({
      text: '正在下载 42%',
      action: 'none',
      actionLabel: '检查更新',
    })
  })

  test('已就绪显示重启引导', () => {
    expect(describeUpdateStatus({ ...base, status: 'ready', availableVersion: '0.1.1880', percent: 100 })).toEqual({
      text: '0.1.1880 已就绪，重启生效',
      action: 'install',
      actionLabel: '立即重启',
    })
  })

  // 后台自动检查失败必须静默——用户不该为一次后台失败被打扰。
  test('自动检查失败不显示错误', () => {
    expect(describeUpdateStatus({ ...base, status: 'error', manual: false })).toEqual({
      text: '已是最新',
      action: 'check',
      actionLabel: '检查更新',
    })
  })

  test('手动检查失败显示失败', () => {
    expect(describeUpdateStatus({ ...base, status: 'error', manual: true })).toEqual({
      text: '检查失败，请稍后再试',
      action: 'check',
      actionLabel: '检查更新',
    })
  })
})

describe('shouldShowUpdateBadge', () => {
  const ready: UpdaterState = { ...base, status: 'ready', availableVersion: '0.1.1880', percent: 100 }

  test('已就绪且空闲时显示角标', () => {
    expect(shouldShowUpdateBadge({ state: ready, hasActiveRuns: false })).toBe(true)
  })

  // 一次 run 十几分钟且花钱，跑 Agent 期间任何更新提示都是打扰。
  test('正在跑 Agent 时抑制角标', () => {
    expect(shouldShowUpdateBadge({ state: ready, hasActiveRuns: true })).toBe(false)
  })

  test('下载中不显示角标', () => {
    expect(shouldShowUpdateBadge({ state: { ...base, status: 'downloading' }, hasActiveRuns: false })).toBe(false)
  })
})
