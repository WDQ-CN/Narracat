import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve, dirname, relative } from 'node:path'
import { pathToFileURL } from 'node:url'

const SCAN_DIRS = ['electron', 'src', 'shared']
const EXTS = new Set(['.ts', '.tsx', '.cts', '.mts'])
// 拆旧刀5：claude-agent-sdk 已全链退役——全仓任何位置（含 adapters/）出现即违规；
// pi 双包仍只许 adapters/ 目录内接触。
const BANNED_PACKAGES = ['@anthropic-ai/claude-agent-sdk']
const RUNTIME_PACKAGES = ['@mariozechner/']
const ADAPTER_PREFIX = 'electron/main/agent/runtime/adapters/'
const SKIP_DIR_NAMES = new Set(['node_modules', 'dist', 'out'])
// 三类导入语法一网打尽：静态 import/export-from、动态 import()、require()
const IMPORT_RE =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm

export function collectViolations(rootDir) {
  const violations = []
  for (const dir of SCAN_DIRS) {
    for (const file of walk(join(rootDir, dir))) {
      if ([...EXTS].every((e) => !file.endsWith(e))) continue
      if (/\.test\.[cm]?tsx?$/.test(file)) continue // 测试文件豁免（可跨层拿 fixture）
      const rel = relative(rootDir, file).replaceAll('\\', '/')
      const layer = rel.split('/')[0]
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(IMPORT_RE)) {
        const spec = m[1] ?? m[2] ?? m[3] ?? m[4]
        if (!spec) continue
        const line = text.slice(0, m.index).split('\n').length
        const target = resolveLayer(spec, file, rootDir)
        if (layer === 'electron' && target === 'src')
          violations.push({ file: rel, line, importPath: spec, rule: 'electron-to-src' })
        if (layer === 'src' && target === 'electron')
          violations.push({ file: rel, line, importPath: spec, rule: 'src-to-electron' })
        if (layer === 'shared' && (target === 'src' || target === 'electron'))
          violations.push({ file: rel, line, importPath: spec, rule: 'shared-to-app' })
        if (
          RUNTIME_PACKAGES.some((p) =>
            p.endsWith('/') ? spec.startsWith(p) : spec === p || spec.startsWith(p + '/'),
          ) &&
          !rel.startsWith(ADAPTER_PREFIX)
          // import type 不豁免：runtime 包类型只经 adapters/ 内模块转译成中立契约后出门。
        )
          violations.push({ file: rel, line, importPath: spec, rule: 'runtime-leak' })
        if (BANNED_PACKAGES.some((p) => spec === p || spec.startsWith(p + '/')))
          violations.push({ file: rel, line, importPath: spec, rule: 'retired-runtime' })
      }
    }
  }
  return violations
}

function resolveLayer(spec, fromFile, rootDir) {
  let abs
  if (spec.startsWith('.')) abs = resolve(dirname(fromFile), spec)
  else if (spec.startsWith('@/')) abs = join(rootDir, 'src', spec.slice(2))
  else if (spec.startsWith('@shared/')) abs = join(rootDir, 'shared', spec.slice(8))
  else return null // 裸包名
  const rel = relative(rootDir, abs).replaceAll('\\', '/')
  return rel.split('/')[0] // 'electron' | 'src' | 'shared' | ...
}

// 解析 --allow <rule> 参数：支持重复出现（--allow a --allow b）与逗号列表（--allow a,b）
export function parseAllowedRules(argv) {
  const rules = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--allow' && argv[i + 1]) {
      rules.push(
        ...argv[i + 1]
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      )
    }
  }
  return rules
}

// 被豁免规则的违规仍标注返回（供打印），但不计入 enforceCount（供 --enforce 退出码判定）
export function partitionViolations(violations, allowedRules) {
  const allowedSet = new Set(allowedRules)
  let enforceCount = 0
  const annotated = violations.map((v) => {
    const allowed = allowedSet.has(v.rule)
    if (!allowed) enforceCount++
    return { ...v, allowed }
  })
  return { annotated, enforceCount }
}

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return [] // 目录不存在（如 fixture 里未创建 shared/）
  }
  const files = []
  for (const entry of entries) {
    if (SKIP_DIR_NAMES.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) files.push(...walk(full))
    else if (stat.isFile()) files.push(full)
  }
  return files
}

// 主模块入口：违规打印 file:line rule importPath；--allow <rule> 豁免的违规仍打印(标注 allowed)
// 但不计入 enforceCount；--enforce 且 enforceCount > 0 则 process.exit(1)
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const allowedRules = parseAllowedRules(process.argv.slice(2))
  const violations = collectViolations(process.cwd())
  const { annotated, enforceCount } = partitionViolations(violations, allowedRules)
  for (const v of annotated)
    console.log(`${v.file}:${v.line} [${v.rule}] ${v.importPath}${v.allowed ? ' (allowed)' : ''}`)
  console.log(`${violations.length} violation(s), ${enforceCount} enforced`)
  if (process.argv.includes('--enforce') && enforceCount > 0) process.exit(1)
}
