/**
 * memory 通道端到端冒烟：临时小说项目 fixture → electron 以 NARRACAT_MEMORY_SMOKE 模式启动 →
 * 校验 utilityProcess 真链路（Electron-ABI sqlite / core dist 动态加载 / RPC 往返）结果。
 * NARRACAT_SMOKE_ELECTRON_BIN 可覆盖 electron 二进制（Task 9 用打包产物 NarraCat 复跑同脚本）。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const projectPath = mkdtempSync(join(tmpdir(), 'narracat-smoke-'))
mkdirSync(join(projectPath, '.narracat'), { recursive: true })
writeFileSync(
  join(projectPath, '.narracat', 'config.yaml'),
  'novel_id: "smoke-novel"\nestimated_total_chapters: 12\nwords_per_chapter: 3000\n',
)
const outPath = join(projectPath, 'smoke-result.json')
// dev 态无打包模型：指一个空目录让 embedding 快速失败→优雅降级纯 FTS，冒烟不联网不抖动。
// 打包态 host 的 buildEnv 会以真实 resources 模型路径覆盖此值（env 展开顺序 host 覆盖在后）。
const dummyModelDir = join(projectPath, 'no-model')
mkdirSync(dummyModelDir, { recursive: true })

const electronBin = process.env.NARRACAT_SMOKE_ELECTRON_BIN ?? join(root, 'node_modules/.bin/electron')
// 传项目根目录（非直接指向 out/main/index.js 脚本文件）：Electron 对「脚本文件」参数取其所在目录
// 作为 app.getAppPath()，会把 appRoot 算成 out/main（不含 agent-core/narracat），产品代码里 appRoot
// 全线走 app.getAppPath() 的既有约定（同 electron-vite dev / 打包态）；传根目录让 Electron 读根
// package.json 的 main 字段展开，appPath 才等于项目根，与生产路径解析同构。
const electronArgs = process.env.NARRACAT_SMOKE_ELECTRON_BIN ? [] : ['.']

const result = spawnSync(electronBin, electronArgs, {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    NARRACAT_MEMORY_SMOKE: projectPath,
    NARRACAT_MEMORY_SMOKE_OUT: outPath,
    NARRACAT_EMBEDDING_MODEL_PATH: dummyModelDir,
  },
  timeout: 120_000,
})

const report = JSON.parse(readFileSync(outPath, 'utf8'))
if (result.status !== 0 || report.ok !== true) {
  console.error('[smoke-memory] FAIL', JSON.stringify(report, null, 2), 'exit=', result.status)
  process.exit(1)
}
console.log('[smoke-memory] PASS', JSON.stringify(report))
