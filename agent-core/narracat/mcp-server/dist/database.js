/**
 * SQLite 数据库管理
 *
 * 负责打开数据库、WAL 模式设置和扩展加载。
 * Schema DDL 与版本校验在 migrate.ts（4.0 全新建库，不做旧库迁移）。
 * 使用 better-sqlite3 同步 API，契合 MCP stdio 模型。
 */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import * as sqliteVec from "sqlite-vec";
import { initVecTable } from "./utils/vec.js";
import { initSchema, recordNovelId } from "./migrate.js";
let bundledDriver = null;
/** 懒加载默认驱动：core 模块被 Electron 主/工具进程 import 时不触碰 node-ABI 二进制（模块级 import 会直接 ERR_DLOPEN）。 */
function loadBundledDriver() {
    if (!bundledDriver) {
        const require = createRequire(import.meta.url);
        bundledDriver = require("better-sqlite3");
    }
    return bundledDriver;
}
/**
 * 打开或创建 SQLite 数据库，初始化 Schema 并记录归属小说。
 */
export function openDatabase(dbPath, novelId, driver) {
    // 确保目录存在
    mkdirSync(dirname(dbPath), { recursive: true });
    const DriverCtor = driver ?? loadBundledDriver();
    const db = new DriverCtor(dbPath);
    // 性能优化
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("foreign_keys = ON");
    // 加载 sqlite-vec 扩展
    try {
        sqliteVec.load(db);
        console.error("[NovelMemory] sqlite-vec 扩展已加载");
    }
    catch (error) {
        console.error(`[NovelMemory] sqlite-vec 加载失败，向量检索不可用: ${error instanceof Error ? error.message : String(error)}`);
    }
    // 初始化或校验 Schema（版本不兼容时抛错，4.0 不做旧库迁移）
    initSchema(db);
    // 记录归属小说（存量库在此回填），供 App 直读路径识别本库属于哪本小说
    recordNovelId(db, novelId);
    // 初始化向量表（在基础 schema 之后）
    initVecTable(db);
    return db;
}
/**
 * 在事务中执行同步函数。发生异常时自动回滚。
 */
export function withTransaction(db, fn) {
    const tx = db.transaction(fn);
    return tx();
}
