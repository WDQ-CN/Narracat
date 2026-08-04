import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isAbsolute } from "node:path";
import { resolvePackPools, resetPackResolverCache } from "./pack-resolver.js";

let tmp: string;
let projectRoot: string;
let userPacksDir: string;

function writeUserPack(id: string, version = "0.1.0", manifestPatch: Record<string, unknown> = {}) {
  const dir = join(userPacksDir, `${id}@${version}`);   // 布局约定 <id>@<version>，身份以 manifest 为准
  mkdirSync(join(dir, "cards"), { recursive: true });
  writeFileSync(join(dir, "cards", "my-voice.md"), `${id}@${version} 的测试声音。\n`);
  writeFileSync(join(dir, "pack.json"), JSON.stringify({
    pack_format_version: 1, id, name: "用户测试包", author: "tester", version,
    cards: [{ type: "persona", id: "my-voice", name: "我的声音", path: "cards/my-voice.md", keywords: ["冷峻"] }],
    ...manifestPatch,
  }));
}

function writePacksJson(enabled: Array<{ id: string; version?: string }>) {
  mkdirSync(join(projectRoot, ".narracat"), { recursive: true });
  writeFileSync(join(projectRoot, ".narracat", "packs.json"),
    JSON.stringify({ format_version: 1, enabled }));
}

beforeEach(() => {
  resetPackResolverCache();
  tmp = mkdtempSync(join(tmpdir(), "pack-resolver-"));
  projectRoot = join(tmp, "novel"); mkdirSync(projectRoot, { recursive: true });
  userPacksDir = join(tmp, "packs"); mkdirSync(userPacksDir, { recursive: true });
});
afterEach(() => rmSync(tmp, { recursive: true, force: true }));

describe("resolvePackPools", () => {
  it("packs.json 缺失 → 默认只启用 official-base，池含 7 persona + 12 craft + 10 structure", () => {
    const pools = resolvePackPools(projectRoot, { userPacksDir });
    expect(pools.personas).toHaveLength(7);
    expect(pools.craft).toHaveLength(12);
    expect(pools.structure).toHaveLength(10);
    expect(pools.craft.every((c) => c.origin === "official" && c.source_pack_id === "official-base" && isAbsolute(c.absolute_path))).toBe(true);
    expect(pools.structure.every((s) => isAbsolute(s.path))).toBe(true);
  });

  it("启用用户包（锁定版本）→ 用户卡并入候选池，origin=user，带 source_pack_* 溯源", () => {
    writeUserPack("my-pack", "0.1.0");
    writePacksJson([{ id: "official-base" }, { id: "my-pack", version: "0.1.0" }]);
    const pools = resolvePackPools(projectRoot, { userPacksDir });
    const mine = pools.personas.find((p) => p.id === "my-voice");
    expect(mine?.origin).toBe("user");
    expect(mine?.source_pack_id).toBe("my-pack");
    expect(mine?.source_pack_version).toBe("0.1.0");
    expect(mine && isAbsolute(mine.path)).toBe(true);
    expect(pools.personas).toHaveLength(8);
  });

  it("多版本并存 + 版本锁：锁 1.0.0 时新装的 1.1.0 不生效（双轨制轨道二）", () => {
    writeUserPack("my-pack", "1.0.0");
    writeUserPack("my-pack", "1.1.0");
    writePacksJson([{ id: "my-pack", version: "1.0.0" }]);
    const pools = resolvePackPools(projectRoot, { userPacksDir });
    expect(pools.personas).toHaveLength(1);
    expect(pools.personas[0].source_pack_version).toBe("1.0.0");
    expect(pools.personas[0].path).toContain("my-pack@1.0.0");
  });

  it("锁定版本未安装 → 警告跳过（fail-soft）", () => {
    writeUserPack("my-pack", "1.1.0");
    writePacksJson([{ id: "my-pack", version: "1.0.0" }]);
    const pools = resolvePackPools(projectRoot, { userPacksDir });
    expect(pools.personas).toHaveLength(0);
    expect(pools.notes.join()).toContain("my-pack");
  });

  it("显式清单关掉 official-base → 官方卡不入池", () => {
    writeUserPack("my-pack", "0.1.0");
    writePacksJson([{ id: "my-pack", version: "0.1.0" }]);
    const pools = resolvePackPools(projectRoot, { userPacksDir });
    expect(pools.craft).toHaveLength(0);
    expect(pools.personas).toHaveLength(1);
  });

  it("启用了未安装的 id → notes 警告 + fail-soft 跳过", () => {
    writePacksJson([{ id: "official-base" }, { id: "ghost-pack", version: "1.0.0" }]);
    const pools = resolvePackPools(projectRoot, { userPacksDir });
    expect(pools.craft).toHaveLength(12);
    expect(pools.notes.join()).toContain("ghost-pack");
  });

  it("启用清单重复条目防御：official-base 写两遍 → 去重后池仍为 7/12/10（不翻倍）", () => {
    writePacksJson([{ id: "official-base" }, { id: "official-base" }]);
    const pools = resolvePackPools(projectRoot, { userPacksDir });
    expect(pools.personas).toHaveLength(7);
    expect(pools.craft).toHaveLength(12);
    expect(pools.structure).toHaveLength(10);
  });

  it("启用清单同 id 冲突版本条目（1.0.0 与重复的 1.1.0）→ 该 id 整体跳过 + 留痕，不猜测意图", () => {
    writeUserPack("my-pack", "1.0.0");
    writeUserPack("my-pack", "1.1.0");
    writePacksJson([{ id: "my-pack", version: "1.0.0" }, { id: "my-pack", version: "1.1.0" }]);
    const pools = resolvePackPools(projectRoot, { userPacksDir });
    expect(pools.personas).toHaveLength(0);
    expect(pools.notes.join()).toContain("my-pack");
    expect(pools.notes.join()).toContain("冲突");
  });

  it("损坏 manifest 的用户包 → 跳过并警告，不 throw", () => {
    const dir = join(userPacksDir, "broken@0.0.1"); mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "pack.json"), "{not json");
    writePacksJson([{ id: "official-base" }, { id: "broken", version: "0.0.1" }]);
    const pools = resolvePackPools(projectRoot, { userPacksDir });
    expect(pools.craft).toHaveLength(12);
    expect(pools.notes.join()).toContain("broken");
  });
});
