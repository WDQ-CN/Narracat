import { app, BrowserWindow, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createMainWindow } from './window.ts'
import {
  hasActiveAgentRuntimeRuns,
  reconcileAgentRuntimeStartup,
  registerAllIpcHandlers,
  settleAgentRuntimeBeforeQuit,
} from './ipc/registry.ts'
import { disposeAllPendingCapabilityPackImportsSync } from './packs/pack-store.ts'
import { createAgentQuitController } from './agent/runs/agent-quit-controller.ts'
import { resolveNarraCatAgentCorePath } from './engine/engine.ts'
import { maybeRunMemorySmoke } from './memory/memory-smoke.ts'
import { startUpdater } from './updater/updater-runtime.ts'

async function main() {
  await app.whenReady()

  const appRoot = app.getAppPath()
  const resourcesPath = process.resourcesPath
  const userDataPath = app.getPath('userData')
  const agentCorePath = resolveNarraCatAgentCorePath({ appRoot, resourcesPath })
  if (await maybeRunMemorySmoke({ appRoot, resourcesPath, userDataPath, agentCorePath })) return

  registerAllIpcHandlers()
  app.on('activate', () => {
    // macOS：关闭所有窗口后点 dock 重新打开
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
  // 必须排在 createMainWindow() 之前：拦截页（版本过旧强更）在门控判定一回来就渲染，
  // 用户可能立刻点「立即更新并重启」；若 startUpdater() 排在 reconcileAgentRuntimeStartup()
  // 之后（该步骤耗时不定），installUpdateNow() 会因 started === false 直接 return、零反馈——
  // 用户点了按钮却什么都没发生。startUpdater() 本身只做同步的状态机初始化 + 30s 后才真正
  // 发起首次检查，提前调用没有副作用代价。
  startUpdater()
  await reconcileAgentRuntimeStartup()
  if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
}

app.on('window-all-closed', () => {
  // macOS 习惯：所有窗口关闭不退出 app；其他平台退出
  if (process.platform !== 'darwin') app.quit()
})

function restoreMainWindow(): void {
  const window = BrowserWindow.getAllWindows()[0] ?? createMainWindow()
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

const agentQuitController = createAgentQuitController({
  hasActiveRuns: hasActiveAgentRuntimeRuns,
  confirmInterrupt: async () => {
    const { response } = await dialog.showMessageBox({
      type: 'warning',
      title: 'Agent 任务仍在运行',
      message: '退出会中断正在运行的 Agent 任务。',
      detail: '你可以返回 App 等待，或请求停止任务并退出。已写入的小说产物会保留。',
      buttons: ['返回并等待', '退出并中断'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    })
    return response === 1
  },
  restoreWindow: restoreMainWindow,
  interruptAll: settleAgentRuntimeBeforeQuit,
  quit: () => app.quit(),
})

app.on('before-quit', (event) => {
  agentQuitController.handleBeforeQuit(event)
})

app.on('will-quit', () => {
  disposeAllPendingCapabilityPackImportsSync()
})

main().catch((err) => {
  // app.exit() 立即终止、不 flush stdio，console 输出会丢失，导致打包态启动失败"图标闪一下就没"、
  // 无任何可诊断信息。故先把错误持久化到 userData（可回传排查）并弹可见错误框，再退出。
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
  console.error('Main process startup failed:', detail)
  try {
    writeFileSync(join(app.getPath('userData'), 'startup-error.log'), `${detail}\n`)
  } catch {}
  try {
    dialog.showErrorBox('NarraCat 启动失败', detail)
  } catch {}
  app.exit(1)
})
