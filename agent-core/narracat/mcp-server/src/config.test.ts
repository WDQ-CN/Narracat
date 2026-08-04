import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "./config.js";

const cleanupPaths: string[] = [];
const originalConfigPathEnv = process.env.NOVEL_CONFIG_PATH;

afterEach(() => {
  for (const p of cleanupPaths.splice(0)) {
    rmSync(p, { recursive: true, force: true });
  }
  if (originalConfigPathEnv === undefined) {
    delete process.env.NOVEL_CONFIG_PATH;
  } else {
    process.env.NOVEL_CONFIG_PATH = originalConfigPathEnv;
  }
});

function writeConfigYaml(content: string): string {
  const root = mkdtempSync(join(tmpdir(), "narracat-config-"));
  cleanupPaths.push(root);
  const configPath = join(root, "config.yaml");
  writeFileSync(configPath, content, "utf-8");
  process.env.NOVEL_CONFIG_PATH = configPath;
  return configPath;
}

describe("loadConfig — voltageBestofPresentInConfig（电压点判优下线后的 presence 判定）", () => {
  it("config.yaml 原文含 voltage_bestof 行 → presence=true（不折叠成开/关布尔）", async () => {
    writeConfigYaml(
      [
        `novel_id: "test-novel-id"`,
        `title: "测试小说"`,
        `voltage_bestof: "off"`,
      ].join("\n"),
    );

    const config = await loadConfig();
    expect(config.voltageBestofPresentInConfig).toBe(true);
  });

  it("config.yaml 无 voltage_bestof 行（新项目 / 已清理）→ presence=false", async () => {
    writeConfigYaml(
      [`novel_id: "test-novel-id"`, `title: "测试小说"`].join("\n"),
    );

    const config = await loadConfig();
    expect(config.voltageBestofPresentInConfig).toBe(false);
  });
});
