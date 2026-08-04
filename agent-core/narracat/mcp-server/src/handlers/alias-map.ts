/**
 * 共享内部模块：角色别名归一
 *
 * 从 bible/characters/*.md 解析 canonical 名 + 别名 + character_identity uid，
 * 供 writers.ts（抽取写入口归一 subject/relationship）与 readers.ts
 * （novel_extraction_scaffold 渲染别名表）共用同一份实现，消除双副本漂移。
 *
 * 纯只读：仅 readdir/readFile 角色档案，无任何写操作。
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

/** 角色身份解析结果：canonical 名 + uid（无 character_identity 时 uid 为 null） */
export interface ResolvedCharacter {
  canonical: string;
  uid: string | null;
}

/** 角色档案顶部身份注释：<!-- character_identity: {"character_uid":"...","name":"..."} --> */
export const CHARACTER_IDENTITY_RE = /<!--\s*character_identity:\s*(\{[\s\S]*?\})\s*-->/;

/**
 * 从 bible/characters/*.md 构建 name → {canonical, uid} 映射。
 * canonical 名 = 档案文件名（不含 .md）；档案内 `别名: A、B` 行声明别名；
 * 顶部 character_identity 注释提供 canonical uid（无则 uid=null）。
 */
export async function loadAliasMap(
  projectRoot: string,
): Promise<Map<string, ResolvedCharacter>> {
  const map = new Map<string, ResolvedCharacter>();
  const dir = join(projectRoot, "bible", "characters");
  let files: string[];
  try {
    files = await readdir(dir);
  } catch {
    return map;
  }
  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const canonical = file.replace(/\.md$/, "");
    let content: string;
    try {
      content = await readFile(join(dir, file), "utf-8");
    } catch {
      map.set(canonical, { canonical, uid: null });
      continue;
    }
    let uid: string | null = null;
    const idMatch = content.match(CHARACTER_IDENTITY_RE);
    if (idMatch) {
      try {
        const parsed = JSON.parse(idMatch[1]) as { character_uid?: unknown };
        if (typeof parsed.character_uid === "string" && parsed.character_uid.trim()) {
          uid = parsed.character_uid.trim();
        }
      } catch {
        // 身份注释损坏：uid 留 null，不阻断
      }
    }
    const resolved: ResolvedCharacter = { canonical, uid };
    map.set(canonical, resolved);
    const m = content.match(/^[\s>*-]*(?:\*\*)?别名(?:\*\*)?\s*[:：]\s*(.+)$/m);
    if (!m) continue;
    for (const raw of m[1].split(/[、，,;；|/]+/)) {
      const alias = raw.trim().replace(/^["'「『]|["'」』]$/g, "");
      if (alias && alias !== "无" && alias !== "暂无" && !map.has(alias)) {
        map.set(alias, resolved);
      }
    }
  }
  return map;
}

export function normalizeName(
  name: string,
  aliasMap: Map<string, ResolvedCharacter>,
): string {
  const trimmed = name.trim();
  return aliasMap.get(trimmed)?.canonical ?? trimmed;
}

/** 解析角色 name 的 canonical uid；非角色或无 character_identity 时返回 null */
export function resolveCharacterUid(
  name: string,
  aliasMap: Map<string, ResolvedCharacter>,
): string | null {
  return aliasMap.get(name.trim())?.uid ?? null;
}

/** relationship 主体：字典序 (A,B) 归一为 "A|B" */
export function relationshipSubject(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}
