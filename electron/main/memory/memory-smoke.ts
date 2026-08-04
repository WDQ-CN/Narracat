/**
 * memory 通道冒烟模式（切片⑥验收件，非用户功能）：env NARRACAT_MEMORY_SMOKE=<项目路径> 启动时
 * 不开窗口，经真 utilityProcess 打两发只读工具，结果 JSON 落 NARRACAT_MEMORY_SMOKE_OUT 后退出。
 * 先同步写文件再 app.exit——app.exit 不 flush stdout（打包链踩过的坑），stdout 只作辅助。
 */
import { writeFileSync } from 'node:fs'
import { app } from 'electron'
import { MEMORY_EMBEDDING_SELFTEST_TOOL } from '@shared/types/memory-rpc'
import { getMemoryHost } from './index.ts'
import type { MemoryHostPaths } from './index.ts'

export async function maybeRunMemorySmoke(paths: MemoryHostPaths): Promise<boolean> {
  const projectPath = process.env.NARRACAT_MEMORY_SMOKE
  if (!projectPath) return false
  const outPath = process.env.NARRACAT_MEMORY_SMOKE_OUT
  const report: Record<string, unknown> = { ok: false }
  try {
    const host = getMemoryHost(paths)
    const query = await host.callTool(projectPath, 'novel_query', { query: '冒烟' })
    const summary = await host.callTool(projectPath, 'novel_chapter_summary', {})
    // worker 级伪工具（拆旧刀5 前置）：体检探针同通道，selftest 报告 ok 才算冒烟过
    const selftest = await host.callTool(projectPath, MEMORY_EMBEDDING_SELFTEST_TOOL, {})
    const selftestOk = (() => {
      try {
        return (JSON.parse(selftest.text) as { ok?: boolean }).ok === true
      } catch {
        return false
      }
    })()
    report.query = { isError: query.isError, head: query.text.slice(0, 200) }
    report.summary = { isError: summary.isError, head: summary.text.slice(0, 200) }
    report.selftest = { isError: selftest.isError, ok: selftestOk, head: selftest.text.slice(0, 200) }
    report.ok = !query.isError && !summary.isError && selftestOk
  } catch (error) {
    report.error = error instanceof Error ? (error.stack ?? error.message) : String(error)
  }
  if (outPath) writeFileSync(outPath, JSON.stringify(report, null, 2))
  console.error('[memory-smoke]', JSON.stringify(report))
  app.exit(report.ok === true ? 0 : 1)
  return true
}
