/**
 * 小说项目 Agent 说明文件解析：AGENTS.md（pi 时代命名）→ CLAUDE.md（存量书回退）→ null。
 * 单文件精准读取，不上溯祖先（ADR-0028 隔离纪律）；IO 失败静默视同不存在，不阻断 run。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const MAX_GUIDE_BYTES = 32 * 1024
const GUIDE_FILENAMES = ['AGENTS.md', 'CLAUDE.md'] as const

function truncationNotice(filename: string): string {
  return `\n（${filename} 过长，已截断）`
}

export async function resolveNovelAgentsGuide(projectPath: string | undefined): Promise<string | null> {
  if (!projectPath) return null
  for (const filename of GUIDE_FILENAMES) {
    const content = await readFile(join(projectPath, filename), 'utf8').catch(() => null)
    if (content === null) continue
    const trimmed = content.trim()
    if (!trimmed) continue
    if (Buffer.byteLength(trimmed, 'utf8') <= MAX_GUIDE_BYTES) return trimmed
    return `${Buffer.from(trimmed, 'utf8').subarray(0, MAX_GUIDE_BYTES).toString('utf8')}${truncationNotice(filename)}`
  }
  return null
}
