#!/usr/bin/env node
/**
 * craft-pack-lint — novel-web-craft Craft Pack 机制卡 + 索引规范检查（error 级，退出码 1）
 *   - pack-index.json: packs[] 字段齐全 / tags 受控 8×8 / path 带 ${CLAUDE_PLUGIN_ROOT}/ 且存在 / pack_id 唯一
 *   - packs/*.md: 含 [runtime] 四要素（机制注解 + 适用场景 + 不可迁移边界）+ [evidence] 真人证据
 *   - packs/ 与 index 双向一致（每 md 在 index、每 index 项 md 存在）
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACK_DIR = path.join(ROOT, 'skills/novel-web-craft/references')
const INDEX = path.join(PACK_DIR, 'pack-index.json')
const PACKS = path.join(PACK_DIR, 'packs')

const TECHNIQUES = new Set(['对话设计', '心理刻画', '环境描写', '动作细节', '节奏控制', '情感渲染', '视角运用', '悬念设置'])
const EMOTIONS = new Set(['紧张', '悲伤', '愤怒', '暧昧', '幽默', '温暖', '释然', '震撼'])
const PREFIX = '${CLAUDE_PLUGIN_ROOT}/'
const errors = []

if (!existsSync(INDEX)) { console.error(`craft-pack-lint: 缺 ${INDEX}`); process.exit(1) }
let idx
try { idx = JSON.parse(readFileSync(INDEX, 'utf8')) } catch (e) { console.error(`pack-index.json 解析失败: ${e.message}`); process.exit(1) }

const packs = idx.packs || []
const seenId = new Set()
const indexedFiles = new Set()
for (const p of packs) {
  for (const k of ['pack_id', 'path', 'triggers', 'beat_types', 'technique_tags', 'emotion_tags', 'exclusions', 'priority']) {
    if (!(k in p)) errors.push(`pack-index: ${p.pack_id || '?'} 缺字段 ${k}`)
  }
  if (seenId.has(p.pack_id)) errors.push(`pack-index: pack_id 重复「${p.pack_id}」`); else seenId.add(p.pack_id)
  for (const t of p.technique_tags || []) if (!TECHNIQUES.has(t)) errors.push(`${p.pack_id}: technique_tag 越界「${t}」`)
  for (const e of p.emotion_tags || []) if (!EMOTIONS.has(e)) errors.push(`${p.pack_id}: emotion_tag 越界「${e}」`)
  if (typeof p.path !== 'string' || !p.path.startsWith(PREFIX)) {
    errors.push(`${p.pack_id}: path 须以 ${PREFIX} 开头`)
  } else {
    const rel = p.path.slice(PREFIX.length)
    const abs = path.join(ROOT, rel)
    if (!existsSync(abs)) errors.push(`${p.pack_id}: path 指向的文件不存在 ${rel}`)
    indexedFiles.add(path.basename(abs))
  }
}

if (existsSync(PACKS)) {
  for (const f of readdirSync(PACKS).filter((x) => x.endsWith('.md'))) {
    if (!indexedFiles.has(f)) errors.push(`packs/${f} 未在 pack-index.json 登记`)
    const md = readFileSync(path.join(PACKS, f), 'utf8')
    if (!md.includes('[runtime]')) errors.push(`packs/${f}: 缺 [runtime] 块`)
    if (!md.includes('机制注解')) errors.push(`packs/${f}: 缺「机制注解」`)
    if (!md.includes('适用场景')) errors.push(`packs/${f}: 缺「适用场景」`)
    if (!md.includes('不可迁移边界')) errors.push(`packs/${f}: 缺「不可迁移边界」`)
    if (!md.includes('[evidence]')) errors.push(`packs/${f}: 缺 [evidence] 块`)
    if (!md.includes('真人证据')) errors.push(`packs/${f}: 缺「真人证据」`)
    // evidence 真人摘录 ≤300 字（版权/体量上限）。稳健提取「真人证据…「摘录」——机制点评」中的摘录，
    // 兼容三种标记变体（真人证据：/ 真人证据**：/ 真人证据：**）与摘录内层「」对话引号。
    const evMatch = md.match(/真人证据[*：:\s]*「(.+?)」\s*——/s)
    if (evMatch) {
      const exLen = evMatch[1].replace(/\s/g, '').length
      if (exLen > 300) errors.push(`packs/${f}: evidence 真人摘录 ${exLen} 字，超 300 字上限（版权/体量；剪到最能体现机制的核心段）`)
    }
  }
}

if (errors.length) {
  console.error('craft-pack-lint 失败:\n' + errors.map((x) => '  ✗ ' + x).join('\n'))
  process.exit(1)
}
console.log(`✓ craft-pack-lint: ${packs.length} 个 pack 机制卡四要素 + 索引一致`)
