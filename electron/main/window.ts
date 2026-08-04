import { BrowserWindow, shell, type BrowserWindowConstructorOptions } from 'electron'
import { resolve, join } from 'node:path'

const TITLE_BAR_HEIGHT = 56
const MAC_TRAFFIC_LIGHT_Y = 16
const MAIN_DIR = import.meta.dirname

/** 外开链接 scheme 白名单：不可信内容（社区包 README 等）渲染的链接只放行常规网页/邮件协议。 */
const SAFE_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])

export function isSafeExternalUrl(rawUrl: string): boolean {
  try {
    return SAFE_EXTERNAL_PROTOCOLS.has(new URL(rawUrl).protocol)
  } catch {
    return false
  }
}

type PlatformOptions = Pick<
  BrowserWindowConstructorOptions,
  | 'vibrancy'
  | 'visualEffectState'
  | 'transparent'
  | 'backgroundColor'
  | 'titleBarStyle'
  | 'titleBarOverlay'
  | 'trafficLightPosition'
>

function macOptions(): PlatformOptions {
  return {
    vibrancy: 'fullscreen-ui',
    visualEffectState: 'active',
    transparent: true,
    backgroundColor: '#00000000',
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 18, y: MAC_TRAFFIC_LIGHT_Y },
  }
}

function winOptions(): PlatformOptions {
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: '#ffffff',
      height: TITLE_BAR_HEIGHT,
    },
    // 不设 transparent（win 已知闪烁/输入法 bug），fallback-bg.css 提供背景
    backgroundColor: '#1a1a1a',
  }
}

function linuxOptions(): PlatformOptions {
  return {
    backgroundColor: '#1a1a1a',
  }
}

export function getWindowOptions(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  const base: BrowserWindowConstructorOptions = {
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    webPreferences: {
      preload: resolve(MAIN_DIR, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  }
  if (platform === 'darwin') return { ...base, ...macOptions() }
  if (platform === 'win32') return { ...base, ...winOptions() }
  return { ...base, ...linuxOptions() }
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow(getWindowOptions(process.platform))

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    void win.loadFile(join(MAIN_DIR, '../renderer/index.html'))
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}
