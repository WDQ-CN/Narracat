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
