#!/usr/bin/env node
/**
 * corpus-deid-lint — 真人范例检索库「去标识化」回归护栏
 *
 * 防原书名/作者经文件名/字段/记录 id/skill 文档再渗入随包数据。error 级（退出码 1）：
 *   - extracts 文件名不匹配 ^WK-\d+-extracts\.json$
 *   - extracts 顶层含 title / author 键；记录 id 不匹配 ^WK-\d+-\d+$
 *   - index.json works 含 title / author / file 键；meta 含 base_path / duplicates 键
 *   - query-index.md 出现 CJK 前缀的 书名-NNN 残留 id
 *   - 能力 packs（novel-web-craft / novel-structure）evidence 残留来源署名
 *   - novel-style-reference skill 文档（SKILL.md / references 下，corpus/ 除外）渗入
 *     原始语料路径(.txt) / 本地语料库目录名 / 来源署名(作者：)——堵住建库研究产物再混入随包
 */
import { readFileSync, readdirSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

const FILE_RE = /^WK-\d+-extracts\.json$/
const ID_RE = /^WK-\d+-\d+$/

// 随包 skill 文档不得携带的来源标记（结构性强信号，不硬编码书名清单——书名会变、结构不变）。
export function detectSourceSignatures(text) {
  const hits = []
  const RULES = [
    [/小说知识库/g, '本地语料库目录名'],
    [/\S*\.txt/g, '原始语料文件路径(.txt)'],
    [/作者[：:]\s*\S+/g, '来源署名(作者：)'],
  ]
  for (const [re, label] of RULES) {
    for (const m of text.matchAll(re)) hits.push(`${label}「${m[0].trim()}」`)
  }
  return hits
}

function walkMarkdown(dir, skipDirName) {
  const out = []
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      if (ent.name === skipDirName) continue
      out.push(...walkMarkdown(full, skipDirName))
    } else if (ent.name.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

export function lintCorpusDeid(root) {
  const CORPUS = path.join(root, 'skills/novel-style-reference/references/corpus')
  const EXTRACTS = path.join(CORPUS, 'extracts')
  const INDEX = path.join(CORPUS, 'index.json')
  const QUERY = path.join(CORPUS, 'query-index.md')
  const errors = []

  if (!existsSync(EXTRACTS)) return { ok: false, errors: [`缺 extracts 目录 ${EXTRACTS}`] }

  for (const f of readdirSync(EXTRACTS).filter((x) => x.endsWith('.json'))) {
    if (!FILE_RE.test(f)) errors.push(`文件名非 WK 编号: ${f}`)
    let d
    try { d = JSON.parse(readFileSync(path.join(EXTRACTS, f), 'utf8')) }
    catch (e) { errors.push(`${f}: 解析失败 ${e.message}`); continue }
    if ('title' in d) errors.push(`${f}: 残留 title 键`)
    if ('author' in d) errors.push(`${f}: 残留 author 键`)
    for (const e of d.extracts || []) {
      if (!ID_RE.test(e.id || '')) errors.push(`${f}: 记录 id 非 WK 形态「${e.id}」`)
    }
  }

  if (existsSync(INDEX)) {
    let idx
    try { idx = JSON.parse(readFileSync(INDEX, 'utf8')) }
    catch (e) { errors.push(`index.json: 解析失败 ${e.message}`); idx = null }
    if (idx) {
      for (const w of idx.works || []) {
        for (const k of ['title', 'author', 'file']) if (k in w) errors.push(`index.json works[${w.id}]: 残留 ${k} 键`)
      }
      for (const k of ['base_path', 'duplicates']) if (idx.meta && k in idx.meta) errors.push(`index.json meta: 残留 ${k} 键`)
    }
  }

  if (existsSync(QUERY)) {
    const md = readFileSync(QUERY, 'utf8')
    for (const m of md.matchAll(/[一-龥][^\s,，]*-\d{3}\b/gu)) {
      errors.push(`query-index.md: 残留书名前缀 id「${m[0]}」`)
    }
  }

  // packs 去标识化：evidence 不得标来源书名/作者署名（PR#387 去标识化校准）
  const PACKS_DIRS = [
    'skills/novel-web-craft/references/packs',
    'skills/novel-structure/references/packs',
  ]
  for (const rel of PACKS_DIRS) {
    const dir = path.join(root, rel)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.md'))) {
      const md = readFileSync(path.join(dir, f), 'utf8')
      for (const m of md.matchAll(/（?来源[：:]\s*[^）\n]+/g)) {
        errors.push(`${rel}/${f}: evidence 残留来源署名「${m[0].trim()}」（pack 须去标识化、不标书名作者）`)
      }
    }
  }

  // novel-style-reference skill 文档（SKILL.md + references/，corpus/ 已由上面专项检测）
  // 不得渗入原始语料路径 / 本地库目录名 / 来源署名——profiles 研究产物泄漏即由此堵住。
  const SKILL_ROOT = path.join(root, 'skills/novel-style-reference')
  if (existsSync(SKILL_ROOT)) {
    for (const f of walkMarkdown(SKILL_ROOT, 'corpus')) {
      for (const h of detectSourceSignatures(readFileSync(f, 'utf8'))) {
        errors.push(`${path.relative(root, f)}: ${h}`)
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

// 主模块判断用 pathToFileURL 而非裸 file://+argv[1]：后者在脚本路径含空格/需转义字符时
// 与已 %20 转义的 import.meta.url 不等，会让 CLI 分支静默不执行、exit 0（护栏无声失效）。
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const { ok, errors } = lintCorpusDeid(root)
  if (!ok) {
    console.error('corpus-deid-lint 失败:\n' + errors.map((x) => '  ✗ ' + x).join('\n'))
    process.exit(1)
  }
  console.log('✓ corpus-deid-lint: 随包检索库无书名/作者渗透')
}
