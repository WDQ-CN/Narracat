/**
 * 共享内部模块：角色别名归一
 *
 * 从 bible/characters/*.md 解析 canonical 名 + 别名 + character_identity uid，
 * 供 writers.ts（抽取写入口归一 subject/relationship）与 readers.ts
 * （novel_extraction_scaffold 渲染别名表）共用同一份实现，消除双副本漂移。
 *
 * 纯只读：仅 readdir/readFile 角色档案，无任何写操作。
 */
/** 角色身份解析结果：canonical 名 + uid（无 character_identity 时 uid 为 null） */
export interface ResolvedCharacter {
    canonical: string;
    uid: string | null;
}
/** 角色档案顶部身份注释：<!-- character_identity: {"character_uid":"...","name":"..."} --> */
export declare const CHARACTER_IDENTITY_RE: RegExp;
/**
 * 从 bible/characters/*.md 构建 name → {canonical, uid} 映射。
 * canonical 名 = 档案文件名（不含 .md）；档案内 `别名: A、B` 行声明别名；
 * 顶部 character_identity 注释提供 canonical uid（无则 uid=null）。
 */
export declare function loadAliasMap(projectRoot: string): Promise<Map<string, ResolvedCharacter>>;
export declare function normalizeName(name: string, aliasMap: Map<string, ResolvedCharacter>): string;
/** 解析角色 name 的 canonical uid；非角色或无 character_identity 时返回 null */
export declare function resolveCharacterUid(name: string, aliasMap: Map<string, ResolvedCharacter>): string | null;
/** relationship 主体：字典序 (A,B) 归一为 "A|B" */
export declare function relationshipSubject(a: string, b: string): string;
