import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, basename } from 'node:path'
import { pathToFileURL } from 'node:url'

const REQUIRED_SECTIONS = ['## 机制', '## 原则', '## 真人范例', '## 适用']

export function lintStructurePacks(packDir) {
  const errors = []
  const packsDir = join(packDir, 'packs')
  const indexPath = join(packsDir, 'pack-index.json')
  if (!existsSync(indexPath)) return { ok: false, errors: ['缺 pack-index.json'] }
  const index = JSON.parse(readFileSync(indexPath, 'utf-8'))

  // 机制卡四要素 + evidence ≤300
  const mdFiles = readdirSync(packsDir).filter((f) => f.endsWith('.md'))
  for (const f of mdFiles) {
    const body = readFileSync(join(packsDir, f), 'utf-8')
    for (const sec of REQUIRED_SECTIONS) if (!body.includes(sec)) errors.push(`${f} 缺机制卡要素 ${sec}`)
    const evBlock = body.split('## 真人范例')[1]?.split('## 适用')[0] || ''
    for (const line of evBlock.split('\n')) {
      const ev = line.replace(/^>\s*/, '').trim()
      if (ev && ev.length > 300) errors.push(`${f} evidence 超300字（${ev.length}）`)
    }
  }

  // index ↔ packs 双向一致 + path 前缀 + stage 枚举
  const VALID_STAGES = new Set(['stage-1', 'stage-2', 'stage-opening'])
  const idsInDir = new Set(mdFiles.map((f) => basename(f, '.md')))
  for (const p of index.packs || []) {
    if (!p.path?.startsWith('${CLAUDE_PLUGIN_ROOT}/')) errors.push(`${p.id} path 缺 \${CLAUDE_PLUGIN_ROOT}/ 前缀`)
    const fileName = basename(p.path || '')
    if (!existsSync(join(packsDir, fileName))) errors.push(`index 引用的 ${fileName} 不存在`)
    if (!VALID_STAGES.has(p.stage)) errors.push(`${p.id} stage 非法（须 stage-1/stage-2/stage-opening）：${p.stage}`)
    idsInDir.delete(p.id)
  }
  for (const orphan of idsInDir) errors.push(`pack ${orphan}.md 未在 index 登记`)

  // 顶层 always_on 已废弃，分层改由 per-pack stage 表达
  if ('always_on' in index) errors.push('pack-index 顶层 always_on 已废弃，分层由 per-pack stage 表达')

  return { ok: errors.length === 0, errors }
}

// 主模块判断用 pathToFileURL：裸 file://+argv[1] 在路径含空格/转义字符时与 import.meta.url 不等，
// 会让 CLI 分支静默不执行、exit 0（护栏无声失效）。
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = new URL('../skills/novel-structure/references/', import.meta.url).pathname
  const r = lintStructurePacks(dir)
  if (!r.ok) { console.error('lint:structure-pack 失败:\n' + r.errors.map((e) => '  - ' + e).join('\n')); process.exit(1) }
  console.log('lint:structure-pack 通过')
}
