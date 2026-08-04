import { describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase } from "./database.js";
import { initSchema } from "./migrate.js";

function metaNovelId(db: Database.Database): string | undefined {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'novel_id'").get() as
    | { value: string }
    | undefined;
  return row?.value;
}

describe("openDatabase 接线 recordNovelId", () => {
  it("全新库开库即写入 novel_id", () => {
    const dir = mkdtempSync(join(tmpdir(), "novelmemory-db-"));
    const db = openDatabase(join(dir, "memory.db"), "novel-fresh");
    expect(metaNovelId(db)).toBe("novel-fresh");
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("存量库（meta 只有 schema_version 的生产库形态）开库自动回填", () => {
    const dir = mkdtempSync(join(tmpdir(), "novelmemory-db-"));
    const dbPath = join(dir, "memory.db");
    // 模拟引擎写入 novel_id 之前建出的生产库：完整 schema、meta 只有 schema_version
    const legacy = new Database(dbPath);
    initSchema(legacy);
    expect(metaNovelId(legacy)).toBeUndefined();
    legacy.close();

    const db = openDatabase(dbPath, "novel-backfilled");
    expect(metaNovelId(db)).toBe("novel-backfilled");
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
