import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { initSchema } from "../migrate.js";
import type { ToolContext } from "../types.js";
import {
  computeDerivedRelationships,
  loadFactCountByUid,
  loadValidRelationshipEdges,
  type ChapterCharacter,
  type RelationshipEdge,
} from "./derived-relationships.js";

function makeCtx(): ToolContext {
  const db = new Database(":memory:");
  initSchema(db);
  return { novelId: "novel-test", db } as unknown as ToolContext;
}

function insertRelEdge(
  ctx: ToolContext,
  args: {
    id: string;
    aUid: string;
    aName: string;
    bUid: string;
    bName: string;
    state: string;
    fromChapter: number;
    eventChapter?: number | null;
    invalidatedAt?: number | null;
  },
): void {
  ctx.db
    .prepare(
      `INSERT INTO facts
         (id, novel_id, subject, subject_character_uid, subject_character_b_uid,
          predicate, object, from_chapter, event_chapter, invalidated_at_chapter)
       VALUES (?, ?, ?, ?, ?, 'relationship', ?, ?, ?, ?)`,
    )
    .run(
      args.id,
      "novel-test",
      `${args.aName}|${args.bName}`,
      args.aUid,
      args.bUid,
      args.state,
      args.fromChapter,
      args.eventChapter === undefined ? args.fromChapter : args.eventChapter,
      args.invalidatedAt ?? null,
    );
}

const LIN = { uid: "a-lin", name: "林晚" };
const ZHI = { uid: "b-zhi", name: "执事" };
const XUAN = { uid: "c-xuan", name: "玄尘子" };
const HUB = { uid: "d-hub", name: "主角哥" };

function edge(
  a: ChapterCharacter,
  b: ChapterCharacter,
  state: string,
  displayChapter = 1,
): RelationshipEdge {
  return { aUid: a.uid, aName: a.name, bUid: b.uid, bName: b.name, state, displayChapter };
}

/** 让某 uid 满足资格门槛（≥3 条有效事实） */
function qualify(...chars: ChapterCharacter[]): Map<string, number> {
  return new Map(chars.map((c) => [c.uid, 3]));
}

describe("computeDerivedRelationships", () => {
  it("B、C 同师从 A 且无直接边 → 推出含「推断」标记与两条边事实的短句，不含系统命名", () => {
    const lines = computeDerivedRelationships({
      edges: [edge(LIN, XUAN, "师徒", 3), edge(ZHI, XUAN, "师徒", 5)],
      chapterCharacters: [LIN, ZHI],
      factCountByUid: qualify(XUAN),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("推断");
    expect(lines[0]).toContain("林晚");
    expect(lines[0]).toContain("执事");
    expect(lines[0]).toContain("玄尘子");
    expect(lines[0]).toContain("师徒");
    expect(lines[0]).toContain("ch3 起");
    expect(lines[0]).toContain("ch5 起");
    expect(lines[0]).not.toContain("同门");
  });

  it("有直接边的角色对不推派生（即使存在共邻）", () => {
    const lines = computeDerivedRelationships({
      edges: [
        edge(LIN, ZHI, "同僚"),
        edge(LIN, XUAN, "师徒"),
        edge(ZHI, XUAN, "师徒"),
      ],
      chapterCharacters: [LIN, ZHI],
      factCountByUid: qualify(XUAN),
    });
    expect(lines).toEqual([]);
  });

  it("唯一共邻不过资格门槛（事实 <3）→ 完全不输出，宁缺毋滥", () => {
    const lines = computeDerivedRelationships({
      edges: [edge(LIN, XUAN, "旧识"), edge(ZHI, XUAN, "旧识")],
      chapterCharacters: [LIN, ZHI],
      factCountByUid: new Map([[XUAN.uid, 2]]),
    });
    expect(lines).toEqual([]);
  });

  it("枢纽降权：低度数共邻优先于高度数共邻", () => {
    const others = [
      { uid: "e1", name: "甲" },
      { uid: "e2", name: "乙" },
      { uid: "e3", name: "丙" },
    ];
    const lines = computeDerivedRelationships({
      edges: [
        edge(LIN, XUAN, "师徒"),
        edge(ZHI, XUAN, "师徒"),
        edge(LIN, HUB, "结义"),
        edge(ZHI, HUB, "结义"),
        // HUB 另连 3 人 → 度数 5；XUAN 度数 2
        ...others.map((o) => edge(HUB, o, "旧识")),
      ],
      chapterCharacters: [LIN, ZHI],
      factCountByUid: qualify(XUAN, HUB),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("玄尘子");
    expect(lines[0]).not.toContain("主角哥");
  });

  it("条数上限 5：6 对候选只出 5 条", () => {
    // 6 个本章角色两两与各自专属共邻相连，构成 6 个可推对
    const chars = Array.from({ length: 4 }, (_, i) => ({ uid: `p${i}`, name: `角${i}` }));
    const vias = Array.from({ length: 6 }, (_, i) => ({ uid: `v${i}`, name: `桥${i}` }));
    const edges: RelationshipEdge[] = [];
    let vi = 0;
    for (let i = 0; i < chars.length; i++) {
      for (let j = i + 1; j < chars.length; j++) {
        edges.push(edge(chars[i], vias[vi], "旧识"), edge(chars[j], vias[vi], "旧识"));
        vi++;
      }
    }
    const lines = computeDerivedRelationships({
      edges,
      chapterCharacters: chars,
      factCountByUid: qualify(...vias),
    });
    expect(lines).toHaveLength(5);
  });

  it("确定性：edges 与 chapterCharacters 乱序输入，输出逐字相同", () => {
    const input = {
      edges: [
        edge(LIN, XUAN, "师徒", 3),
        edge(ZHI, XUAN, "师徒", 5),
        edge(LIN, HUB, "结义"),
        edge(ZHI, HUB, "结义"),
      ],
      chapterCharacters: [LIN, ZHI],
      factCountByUid: qualify(XUAN, HUB),
    };
    const shuffled = {
      edges: [...input.edges].reverse(),
      chapterCharacters: [...input.chapterCharacters].reverse(),
      factCountByUid: input.factCountByUid,
    };
    expect(computeDerivedRelationships(shuffled)).toEqual(
      computeDerivedRelationships(input),
    );
  });

  it("角色改名后共邻显示当前 canonical 名，而非边上残留的旧名", () => {
    // 边落库时玄尘子还叫「玄尘老道」（改名只迁档案，不重写历史 facts）
    const staleA: RelationshipEdge = {
      aUid: LIN.uid, aName: "林晚", bUid: XUAN.uid, bName: "玄尘老道",
      state: "师徒", displayChapter: 3,
    };
    const staleB: RelationshipEdge = {
      aUid: ZHI.uid, aName: "执事", bUid: XUAN.uid, bName: "玄尘老道",
      state: "师徒", displayChapter: 5,
    };
    const lines = computeDerivedRelationships({
      edges: [staleA, staleB],
      chapterCharacters: [LIN, ZHI],
      factCountByUid: qualify(XUAN),
      canonicalNameByUid: new Map([[XUAN.uid, "玄尘子"]]),
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("玄尘子");
    expect(lines[0]).not.toContain("玄尘老道");
  });

  it("P1 复现：B-C 有 directPairKeys 占位（畸形 subject 直接边）但邻接表无 B-C 边，B-A、C-A 师徒且 A 过资格门槛 → 抑制生效，输出空数组", () => {
    const lines = computeDerivedRelationships({
      edges: [edge(LIN, XUAN, "师徒", 3), edge(ZHI, XUAN, "师徒", 5)],
      chapterCharacters: [LIN, ZHI],
      factCountByUid: qualify(XUAN),
      directPairKeys: new Set([[LIN.uid, ZHI.uid].sort().join("|")]),
    });
    expect(lines).toEqual([]);
  });

  it("本章角色 <2 → 空数组", () => {
    expect(
      computeDerivedRelationships({
        edges: [edge(LIN, XUAN, "师徒")],
        chapterCharacters: [LIN],
        factCountByUid: qualify(XUAN),
      }),
    ).toEqual([]);
  });
});

describe("loadValidRelationshipEdges", () => {
  it("展示章号走 event 轴：第 8 章补叙第 2 章结义 → displayChapter=2", () => {
    const ctx = makeCtx();
    insertRelEdge(ctx, {
      id: "r1", aUid: "u-a", aName: "林晚", bUid: "u-b", bName: "赵伯",
      state: "结义", fromChapter: 8, eventChapter: 2,
    });
    const { edges } = loadValidRelationshipEdges(ctx, 5);
    expect(edges).toHaveLength(1);
    expect(edges[0].displayChapter).toBe(2);
    expect(edges[0].state).toBe("结义");
  });

  it("event 为空回退 from_chapter；生效晚于 asOf 的边不返回", () => {
    const ctx = makeCtx();
    insertRelEdge(ctx, {
      id: "r2", aUid: "u-a", aName: "林晚", bUid: "u-b", bName: "赵伯",
      state: "结义", fromChapter: 8, eventChapter: null,
    });
    expect(loadValidRelationshipEdges(ctx, 5).edges).toEqual([]);
  });

  it("已失效边不返回；同对多条折叠为最新一条", () => {
    const ctx = makeCtx();
    insertRelEdge(ctx, {
      id: "r3", aUid: "u-a", aName: "林晚", bUid: "u-b", bName: "赵伯",
      state: "旧识", fromChapter: 1, invalidatedAt: 3,
    });
    insertRelEdge(ctx, {
      id: "r4", aUid: "u-a", aName: "林晚", bUid: "u-b", bName: "赵伯",
      state: "反目", fromChapter: 3,
    });
    const { edges } = loadValidRelationshipEdges(ctx, 5);
    expect(edges).toHaveLength(1);
    expect(edges[0].state).toBe("反目");
  });

  it("同对两条同时有效边 → 折叠取最新", () => {
    const ctx = makeCtx();
    insertRelEdge(ctx, {
      id: "r6", aUid: "u-a", aName: "林晚", bUid: "u-b", bName: "赵伯",
      state: "旧识", fromChapter: 1,
    });
    insertRelEdge(ctx, {
      id: "r7", aUid: "u-a", aName: "林晚", bUid: "u-b", bName: "赵伯",
      state: "结义", fromChapter: 4,
    });
    const { edges } = loadValidRelationshipEdges(ctx, 5);
    expect(edges).toHaveLength(1);
    expect(edges[0].state).toBe("结义");
  });

  it("event 为空正向回退：asOf 满足 from_chapter 时 displayChapter 回退 from_chapter", () => {
    const ctx = makeCtx();
    insertRelEdge(ctx, {
      id: "r8", aUid: "u-a", aName: "林晚", bUid: "u-b", bName: "赵伯",
      state: "结义", fromChapter: 1, eventChapter: null,
    });
    const { edges } = loadValidRelationshipEdges(ctx, 5);
    expect(edges).toHaveLength(1);
    expect(edges[0].displayChapter).toBe(1);
  });

  it("畸形 subject（无「|」分隔）的有效边：edges 不含该对，但 directPairKeys 含该对 key（直接边存在性只认 UID）", () => {
    const ctx = makeCtx();
    // 直插一条 subject 无「|」分隔的畸形行（正常写入路径不会产出，模拟历史脏数据）
    ctx.db
      .prepare(
        `INSERT INTO facts
           (id, novel_id, subject, subject_character_uid, subject_character_b_uid,
            predicate, object, from_chapter, event_chapter, invalidated_at_chapter)
         VALUES ('r9', 'novel-test', '林晚与赵伯', 'u-a', 'u-b', 'relationship', '旧识', 1, 1, NULL)`,
      )
      .run();
    const { edges, directPairKeys } = loadValidRelationshipEdges(ctx, 5);
    expect(edges).toEqual([]);
    expect(directPairKeys.has(["u-a", "u-b"].sort().join("|"))).toBe(true);
  });
});

describe("loadFactCountByUid", () => {
  it("双列都计数，失效事实不计", () => {
    const ctx = makeCtx();
    insertRelEdge(ctx, {
      id: "r5", aUid: "u-a", aName: "林晚", bUid: "u-b", bName: "赵伯",
      state: "结义", fromChapter: 1,
    });
    ctx.db
      .prepare(
        `INSERT INTO facts (id, novel_id, subject, subject_character_uid, predicate, object, from_chapter, event_chapter, invalidated_at_chapter)
         VALUES ('f1','novel-test','赵伯','u-b','goal','守好药圃',1,1,NULL),
                ('f2','novel-test','赵伯','u-b','location','药圃',1,1,2)`,
      )
      .run();
    const counts = loadFactCountByUid(ctx, 5);
    expect(counts.get("u-a")).toBe(1); // 仅关系边
    expect(counts.get("u-b")).toBe(2); // 关系边 + goal；location 已失效不计
  });
});
