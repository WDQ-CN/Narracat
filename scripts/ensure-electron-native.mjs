/**
 * 确保根 node_modules/better-sqlite3 是 Electron-ABI 构建（utilityProcess memory worker 专用）。
 * 幂等：stamp 文件记录已重建的 Electron 版本，命中即秒退；bun install 重装依赖会抹掉 stamp，
 * 下次自动触发重建。引擎 agent-core/narracat/mcp-server/node_modules 那份保持 node-ABI，勿动。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const electronVersion = JSON.parse(readFileSync(join(root, 'node_modules/electron/package.json'), 'utf8')).version
const stampPath = join(root, 'node_modules/better-sqlite3/.narracat-electron-rebuild')

if (existsSync(stampPath) && readFileSync(stampPath, 'utf8').trim() === electronVersion) {
  process.exit(0)
}

console.log(`[ensure-electron-native] rebuilding better-sqlite3 for Electron ${electronVersion}…`)
const { rebuild } = await import('@electron/rebuild')
await rebuild({ buildPath: root, electronVersion, onlyModules: ['better-sqlite3'], force: true })
writeFileSync(stampPath, electronVersion)
console.log('[ensure-electron-native] done')
