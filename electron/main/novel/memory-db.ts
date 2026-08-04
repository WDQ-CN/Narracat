import { DatabaseSync } from 'node:sqlite'

/**
 * NovelMemory（`.narracat/memory.db`）只读访问层。
 *
 * App 对 memory.db 是**只读**聚合（写入由 memory-keeper 经提交工具独占，ADR 写权限隔离）。
 * 运行时用 Node 内建 `node:sqlite`（DatabaseSync）以 readOnly 打开；测试可注入自带后端的
 * reader（如 bun:sqlite），聚合逻辑对 reader 接口纯函数化。
 *
 * 注意：本模块静态 import `node:sqlite`，只应被主进程真实接线（ipc.ts）引用，
 * 不应被聚合逻辑或其测试 import——聚合逻辑只依赖 MemoryDbReader / OpenMemoryDb 接口。
 */

export interface MemoryDbReader {
  all<T = Record<string, unknown>>(sql: string, ...params: Array<string | number | null>): T[]
  close(): void
}

export type OpenMemoryDb = (dbPath: string) => MemoryDbReader

/** 默认只读打开器：Node 内建 sqlite，readOnly 模式，绝不获得写权限。 */
export const openMemoryDbReadonly: OpenMemoryDb = (dbPath: string): MemoryDbReader => {
  const db = new DatabaseSync(dbPath, { readOnly: true })

  return {
    all<T = Record<string, unknown>>(sql: string, ...params: Array<string | number | null>): T[] {
      return db.prepare(sql).all(...params) as T[]
    },
    close(): void {
      db.close()
    },
  }
}
