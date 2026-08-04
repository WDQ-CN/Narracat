import { describe, expect, it } from "vitest";
import { novelMintCharacterUid } from "./identity.js";
import type { ToolContext } from "../types.js";

// mint 无副作用、不依赖 ctx / db
const ctx = {} as ToolContext;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("novel_mint_character_uid", () => {
  it("返回 valid lowercase UUID v4", async () => {
    const result = (await novelMintCharacterUid({}, ctx)) as { character_uid: string };
    expect(result.character_uid).toMatch(UUID_V4);
  });

  it("多次调用返回唯一 UID", async () => {
    const uids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const result = (await novelMintCharacterUid({}, ctx)) as { character_uid: string };
      uids.add(result.character_uid);
    }
    expect(uids.size).toBe(100);
  });
});
