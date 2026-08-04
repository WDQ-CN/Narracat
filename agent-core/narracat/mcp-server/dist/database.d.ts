/**
 * SQLite 数据库管理
 *
 * 负责打开数据库、WAL 模式设置和扩展加载。
 * Schema DDL 与版本校验在 migrate.ts（4.0 全新建库，不做旧库迁移）。
 * 使用 better-sqlite3 同步 API，契合 MCP stdio 模型。
 */
import type Database from "better-sqlite3";
/** better-sqlite3 驱动构造器类型。utilityProcess 宿主注入 Electron-ABI 构建；缺省懒加载本包 node_modules 的 node-ABI 构建。 */
export type SqliteDriver = typeof Database;
/**
 * 打开或创建 SQLite 数据库，初始化 Schema 并记录归属小说。
 */
export declare function openDatabase(dbPath: string, novelId: string, driver?: SqliteDriver): Database.Database;
/**
 * 在事务中执行同步函数。发生异常时自动回滚。
 */
export declare function withTransaction<T>(db: Database.Database, fn: () => T): T;
