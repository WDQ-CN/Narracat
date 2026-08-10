// 散文块守卫：保护用户的 prose-overrides 存量不被引擎重构悄悄弄坏。
//
// 用户的 override 以块 id 为键。贡献者手滑改一个 id，全世界该条设置即静默孤儿化——这是唯一
// 挡得住的硬手段。故 id 一旦发布不得改名，删除必须显式更新 lock（等同 schema 字段的待遇）。
//
// 校验：① 标记成对闭合 ② id 为 kebab-case ③ 跨文件全局唯一 ④ 与 lock 双向一致。

import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const AGENTS_DIR = 'agent-core/narracat/agents'
const LOCK_PATH = 'agent-core/narracat/prose-blocks.lock.json'
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const OPEN_RE = /<!--\s*narracat:prose\b([\s\S]*?)-->/g
const CLOSE_RE = /<!--\s*\/narracat:prose\s*-->/g

function lineOf(content, index) {
  return content.slice(0, index).split('\n').length
}

/**
 * @param {{ files: { path: string, content: string }[], lockIds: string[] }} input
 * @returns {{ rule: string, file?: string, line?: number, id?: string, message: string }[]}
 */
export function collectProseBlockViolations({ files, lockIds }) {
  const violations = []
  const seen = new Map() // id -> file

  for (const file of files) {
    OPEN_RE.lastIndex = 0
    const opens = []
    let openMatch
    while ((openMatch = OPEN_RE.exec(file.content)) !== null) {
      const attrs = {}
      for (const attr of openMatch[1].matchAll(/(\w+)="([^"]*)"/g)) attrs[attr[1]] = attr[2]
      opens.push({ start: openMatch.index, bodyStart: openMatch.index + openMatch[0].length, attrs })
    }

    for (let i = 0; i < opens.length; i += 1) {
      const open = opens[i]
      const id = (open.attrs.id ?? '').trim()
      const line = lineOf(file.content, open.start)

      CLOSE_RE.lastIndex = open.bodyStart
      const closeMatch = CLOSE_RE.exec(file.content)
      // 闭标记之前又出现下一个开标记 → 本块借用了后者的闭标记，实为未闭合。
      // 与运行时解析器 parseProseBlocks 的语义对齐：丢弃本块，让下一个开标记自己去配对。
      const next = opens[i + 1]
      const stolenByNext = next && closeMatch && next.start < closeMatch.index

      if (!closeMatch || stolenByNext) {
        violations.push({ rule: 'unclosed', file: file.path, line, id, message: '开标记没有配对的 <!-- /narracat:prose -->' })
        continue
      }
      if (!id || !ID_RE.test(id)) {
        violations.push({ rule: 'bad-id', file: file.path, line, id, message: 'id 缺失或不是 kebab-case' })
        continue
      }
      if (seen.has(id)) {
        violations.push({ rule: 'duplicate-id', file: file.path, line, id, message: `id 与 ${seen.get(id)} 重复（须跨文件全局唯一）` })
        continue
      }
      seen.set(id, file.path)

      if (!lockIds.includes(id)) {
        violations.push({ rule: 'missing-from-lock', file: file.path, line, id, message: `新增块 id 未登记进 ${LOCK_PATH}` })
      }
    }
  }

  for (const id of lockIds) {
    if (!seen.has(id)) {
      violations.push({
        rule: 'removed-without-lock-update',
        id,
        message: `${LOCK_PATH} 里有此 id 但引擎文件里已不存在。id 一旦发布不得改名——若确为有意删除，请同步移除 lock 条目并 bump 引擎版本；用户对该块的存量设置会自然失效（设置页会提示，不静默丢弃）。`,
      })
    }
  }

  return violations
}

function readAgentFiles() {
  return readdirSync(AGENTS_DIR)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({ path: join(AGENTS_DIR, name), content: readFileSync(join(AGENTS_DIR, name), 'utf-8') }))
}

// ESM 主模块判断必须用 pathToFileURL：裸 `file://${process.argv[1]}` 在路径含空格/软链时
// 与 %20 转义过的 import.meta.url 不相等，会静默 exit 0 让护栏失效。
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lock = JSON.parse(readFileSync(LOCK_PATH, 'utf-8'))
  const violations = collectProseBlockViolations({ files: readAgentFiles(), lockIds: lock.ids ?? [] })
  for (const violation of violations) {
    const where = violation.file ? `${violation.file}:${violation.line}` : LOCK_PATH
    console.error(`${where}  ${violation.rule}  ${violation.id ?? ''}  ${violation.message}`)
  }
  if (violations.length > 0) {
    console.error(`\n散文块守卫失败：${violations.length} 处违规。`)
    process.exit(1)
  }
  console.log('散文块守卫通过。')
}
