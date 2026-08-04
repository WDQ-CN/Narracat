// 目录 ↔ narracat.manifest.json 双向一致门（切片⑤ I-2）：
// 引擎侧新增/删除五类文件而忘改 manifest 时 CI 变红（切片④只有单向 floor 校验）。
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const CATEGORIES = ['commands', 'agents', 'skills', 'schemas', 'templates']

export function readDiskInventory(rootDir) {
  const mdIds = (dir) =>
    readdirSync(join(rootDir, dir)).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')).sort()
  const jsonIds = (dir) =>
    readdirSync(join(rootDir, dir)).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '')).sort()
  const skillIds = () =>
    readdirSync(join(rootDir, 'skills'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && existsSync(join(rootDir, 'skills', e.name, 'SKILL.md')))
      .map((e) => e.name)
      .sort()
  return { commands: mdIds('commands'), agents: mdIds('agents'), skills: skillIds(), schemas: jsonIds('schemas'), templates: mdIds('templates') }
}

export function lintManifestSync({ manifest, disk }) {
  const violations = []
  for (const category of CATEGORIES) {
    const listed = new Set(Array.isArray(manifest[category]) ? manifest[category] : [])
    const onDisk = new Set(disk[category] ?? [])
    for (const id of onDisk) {
      if (!listed.has(id)) violations.push(`${category}: 目录存在「${id}」但不在 manifest 清单里（新增文件须同步 narracat.manifest.json）`)
    }
    for (const id of listed) {
      if (!onDisk.has(id)) violations.push(`${category}: manifest 声明「${id}」但文件不存在（删除文件须同步 narracat.manifest.json）`)
    }
  }
  return violations
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = JSON.parse(readFileSync(join(rootDir, 'narracat.manifest.json'), 'utf-8'))
  const violations = lintManifestSync({ manifest, disk: readDiskInventory(rootDir) })
  if (violations.length > 0) {
    console.error(`lint:manifest-sync 失败（${violations.length} 处）：`)
    for (const violation of violations) console.error(`  - ${violation}`)
    process.exit(1)
  }
  console.log('lint:manifest-sync 通过：五类目录与 manifest 双向一致。')
}
