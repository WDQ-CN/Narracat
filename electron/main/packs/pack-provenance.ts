// PackProvenanceStore + 事件日志：造包中心「发布铸版」的溯源与审计尾巴（B2 刀3 Task 7）。
//
// provenance：记录每个用户包版本的本机来源（作者原创 / 从自己作品学得 / 从外部作品学得）+ 草稿/学习来源关联，
// 单 JSON 文件 `userData/pack-provenance.json`，key=`<id>@<version>`——与 skill-mount-store.ts 同款
// 「读改写」单文件模式。
//
// fail-soft/fail-closed 分野（PR#477 外审 P1-4）：文件不存在（ENOENT）是合法初始态（从未发布/导入过任何
// 带 provenance 的包）→ 空记录，继续 fail-soft，不阻断包库读取；但文件存在却读不出来（JSON 损坏/非对象
// 结构）→ fail-closed 抛错——此前这条也被当空记录放行，等价于把全部包的来源标记一并抹掉，导出侧查无
// entry 会把 learned-external 包误判成「imported」直接原样转发导出，绕过来源锁（外审实证）。消费方
// （exportCapabilityPack/copyPackToDraft/readLocalPackContent）各自决定 catch 后如何 fail-closed。
//
// 纵深标记 `.narracat-local-source.json`：learned-* 包发布时额外在包版本目录写一份（见
// writePackLocalSourceMarker），供导出侧在 provenance 门之前先查——即便 pack-provenance.json 被
// 整份删除/损坏，标记仍在，导出仍会挡住 learned-external。标记只用于「收紧」判断，从不用于放宽，
// 故不需要防伪校验；标记本身缺失/损坏一律 fail-soft 退回正常 provenance 门判断。
//
// 事件日志：`userData/pack-events.jsonl`，一行一个 JSON 事件，只追加不改写（enable/disable/upgrade/publish/export
// 审计追踪；本 task 只建 appender，接线到具体操作调用点是后续 task 的范畴）。

import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { PackLocalSource } from '@shared/types/capability-pack'

export const PACK_LOCAL_SOURCE_MARKER_FILENAME = '.narracat-local-source.json'

export interface PackProvenanceEntry {
  source: PackLocalSource
  draftId?: string
  derivedFrom?: string
}

export type PackProvenanceRecord = Record<string, PackProvenanceEntry>

export interface PackEvent {
  action: 'enable' | 'disable' | 'upgrade' | 'publish' | 'export'
  packId: string
  version?: string
  projectPath?: string
}

export function packProvenancePath(userDataPath: string): string {
  return join(userDataPath, 'pack-provenance.json')
}
export function packEventsPath(userDataPath: string): string {
  return join(userDataPath, 'pack-events.jsonl')
}

/**
 * 读 provenance 记录：文件不存在（ENOENT，合法初始态）→ 空记录，fail-soft；文件存在但读不出来
 * （IO 错误 / JSON 损坏 / 非对象结构）→ fail-closed 抛错，交给消费方决定各自的拒绝形态（见文件头注释）。
 */
export async function readPackProvenance(userDataPath: string): Promise<PackProvenanceRecord> {
  let raw: string
  try {
    raw = await readFile(packProvenancePath(userDataPath), 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw new Error('本机包来源记录无法读取')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('本机包来源记录无法读取')
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as PackProvenanceRecord
  throw new Error('本机包来源记录无法读取')
}

/** 纵深标记写入：learned-* 包发布时调用（见 pack-publish.ts ⑥ 之后）。 */
export async function writePackLocalSourceMarker(packDir: string, localSource: PackLocalSource): Promise<void> {
  await writeFile(join(packDir, PACK_LOCAL_SOURCE_MARKER_FILENAME), JSON.stringify({ localSource }), 'utf8')
}

/** 纵深标记读取：缺失/损坏一律 fail-soft 返回 undefined——标记只用于收紧判断，读不到就退回正常 provenance 门，不会因为标记本身读取失败而放宽或收紧。 */
export async function readPackLocalSourceMarker(packDir: string): Promise<PackLocalSource | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(packDir, PACK_LOCAL_SOURCE_MARKER_FILENAME), 'utf8'))
    if (raw && typeof raw === 'object' && typeof (raw as Record<string, unknown>).localSource === 'string') {
      return (raw as Record<string, unknown>).localSource as PackLocalSource
    }
  } catch {
    // 缺失/损坏：不影响后续正常 provenance 门判断
  }
  return undefined
}

async function writePackProvenance(userDataPath: string, record: PackProvenanceRecord): Promise<void> {
  const path = packProvenancePath(userDataPath)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

/** 写入/覆盖一条 provenance 记录（upsert 语义，同 key 直接覆盖）。 */
export async function recordPackProvenance(userDataPath: string, key: string, entry: PackProvenanceEntry): Promise<void> {
  const record = await readPackProvenance(userDataPath)
  record[key] = entry
  await writePackProvenance(userDataPath, record)
}

/** 移除一条 provenance 记录（卸载包时调用；key 不存在则静默跳过）。 */
export async function removePackProvenance(userDataPath: string, key: string): Promise<void> {
  const record = await readPackProvenance(userDataPath)
  if (!(key in record)) return
  delete record[key]
  await writePackProvenance(userDataPath, record)
}

/** 追加一条事件日志（JSONL）。ts 由本函数打时间戳，不信调用方传入；目录不存在时新建。 */
export async function appendPackEvent(userDataPath: string, event: PackEvent): Promise<void> {
  const path = packEventsPath(userDataPath)
  await mkdir(dirname(path), { recursive: true })
  await appendFile(path, `${JSON.stringify({ ...event, ts: new Date().toISOString() })}\n`, 'utf8')
}
