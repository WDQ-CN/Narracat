#!/usr/bin/env node
/**
 * corpus-lint — novel-style-reference 语料库数据规范检查
 *
 * 入库标准 SSOT：skills/novel-style-reference/references/corpus/README.md
 *
 * error 级（退出码 1，阻塞）——「无机制注解不入库」的机械化：
 *   - extracts/*.json 不可解析 / 缺 work_id|extracts
 *   - 条目缺 id / paragraph / annotation（机制注解必填）
 *   - technique 为空或含 8 手法词汇表外的 tag；emotion 含 8 情感词汇表外的 tag
 *     （tag 值域 SSOT：mcp-server/src/tools.ts novel_query_style_reference 定义；
 *      错 tag 会让条目永远检索不中——静默失效比报错更糟）
 *   - 条目 id 跨语料库重复
 *
 * warning 级（仅提示，不阻塞）——已知存量问题，清理后可升级：
 *   - extracts 的 work_id 不在 index.json works[].id 中
 *   （corpus-loader 按 work_id 匹配，以上不影响运行时检索）
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_DIR = path.join(ROOT, "skills/novel-style-reference/references/corpus");
const EXTRACTS_DIR = path.join(CORPUS_DIR, "extracts");
const INDEX_PATH = path.join(CORPUS_DIR, "index.json");

const TECHNIQUES = new Set(["对话设计", "心理刻画", "环境描写", "动作细节", "节奏控制", "情感渲染", "视角运用", "悬念设置"]);
const EMOTIONS = new Set(["紧张", "悲伤", "愤怒", "暧昧", "幽默", "温暖", "释然", "震撼"]);

const errors = [];
const warnings = [];
const blank = (v) => typeof v !== "string" || v.trim() === "";

if (!existsSync(EXTRACTS_DIR)) {
  console.error(`corpus-lint: 找不到 extracts 目录 ${EXTRACTS_DIR}`);
  process.exit(1);
}

let indexWorks = new Map();
try {
  const index = JSON.parse(readFileSync(INDEX_PATH, "utf8"));
  for (const w of index.works ?? []) indexWorks.set(w.id, w);
} catch (e) {
  errors.push(`index.json 不可解析：${e.message}`);
}

const seenIds = new Map();
let fileCount = 0;
let entryCount = 0;

for (const file of readdirSync(EXTRACTS_DIR).filter((f) => f.endsWith(".json")).sort()) {
  const rel = `extracts/${file}`;
  let data;
  try {
    data = JSON.parse(readFileSync(path.join(EXTRACTS_DIR, file), "utf8"));
  } catch (e) {
    errors.push(`${rel}: JSON 不可解析（${e.message}）`);
    continue;
  }
  fileCount += 1;

  if (blank(data.work_id)) errors.push(`${rel}: 缺 work_id`);
  if (!Array.isArray(data.extracts) || data.extracts.length === 0) {
    errors.push(`${rel}: extracts 缺失或为空`);
    continue;
  }

  if (!blank(data.work_id) && indexWorks.size > 0) {
    const indexed = indexWorks.get(data.work_id);
    if (!indexed) {
      warnings.push(`${rel}: work_id ${data.work_id} 不在 index.json（按 work_id 检索时该文件将被跳过）`);
    }
  }

  for (const entry of data.extracts) {
    entryCount += 1;
    const id = blank(entry.id) ? `${rel}#${entryCount}` : entry.id;
    if (blank(entry.id)) errors.push(`${rel}: 条目缺 id`);
    else if (seenIds.has(entry.id)) errors.push(`${rel}: 条目 id ${entry.id} 与 ${seenIds.get(entry.id)} 重复`);
    else seenIds.set(entry.id, rel);

    if (blank(entry.paragraph)) errors.push(`${id}: 缺 paragraph`);
    if (blank(entry.annotation)) errors.push(`${id}: 缺 annotation（机制注解必填——无机制注解不入库）`);

    if (!Array.isArray(entry.technique) || entry.technique.length === 0) {
      errors.push(`${id}: technique 缺失或为空（至少 1 个手法 tag）`);
    } else {
      for (const t of entry.technique) if (!TECHNIQUES.has(t)) errors.push(`${id}: technique tag「${t}」不在 8 手法词汇表`);
    }
    if (Array.isArray(entry.emotion)) {
      for (const e of entry.emotion) if (!EMOTIONS.has(e)) errors.push(`${id}: emotion tag「${e}」不在 8 情感词汇表`);
    }
  }
}

console.log("=== corpus-lint Summary ===");
console.log(`语料文件: ${fileCount} · 条目: ${entryCount}`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const e of errors) console.log(`  ✗ ${e}`);
console.log(`warning: ${warnings.length} · error: ${errors.length}`);

if (errors.length > 0) {
  console.error("corpus-lint: 数据规范不通过（入库标准见 corpus/README.md）");
  process.exit(1);
}
console.log("✓ corpus-lint: 语料库数据规范通过（annotation 全员在位）");
