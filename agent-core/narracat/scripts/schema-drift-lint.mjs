#!/usr/bin/env node
/**
 * schema-drift-lint
 * ================
 *
 * 目标：检测 prompt 文件（agents/ + commands/ + skills/ + docs/contracts/）中
 *       与 schemas/*.json 真值不一致的版本号引用、以及已弃用字段名的残留引用。
 *
 * 检测项：
 *   A. 版本号漂移：形如 "WritingContextPack v1.0" 的引用，若左侧词是已知
 *      schema title，则与 schemas/*.json 真实 version 对比，不匹配则报告。
 *   B. 已弃用字段引用：白名单字段在 prompt 中仍被引用则报告（用 word boundary
 *      过滤误伤）。
 *
 * Ignore 机制（issue #118 引入）：
 *   - 在需要保留字段名 / 旧版本号的历史说明行上方加 `<!-- drift-lint-ignore-next-line -->`
 *     注释，扫描时跳过紧邻的下一行（A 与 B 都跳）。
 *   - 用于「该字段已废弃」式的 changelog/护栏说明，避免被迫改写丢失语义。
 *
 * 输出格式：ESLint 风格 `file:line:col message`，分两段（A/B）输出 + summary。
 *
 * 退出码：发现任意漂移 → 1；否则 → 0。
 *
 * 用法：
 *   node scripts/schema-drift-lint.mjs        # 仓库根目录运行
 *   npm run lint:schema-drift                 # 通过根 package.json scripts 入口
 *
 * 文档：docs/agents/domain.md「Schema drift lint」节
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

const SCHEMAS_DIR = path.join(REPO_ROOT, 'schemas');

// ----- 扫描目标 -----
// 扁平目录：agents/*.md / commands/*.md / docs/contracts/*.md
// 嵌套目录：skills/**/*.md（含 SKILL.md + references/*.md）
const SCAN_TARGETS = [
  { dir: path.join(REPO_ROOT, 'agents'), recursive: false },
  { dir: path.join(REPO_ROOT, 'commands'), recursive: false },
  { dir: path.join(REPO_ROOT, 'skills'), recursive: true },
  { dir: path.join(REPO_ROOT, 'docs', 'contracts'), recursive: false },
];

// ----- 检测项 B：已弃用字段白名单 -----
// 维护历史已废弃但 prompt 中可能残留的字段名。
// 注意：仅匹配 word boundary，避免误伤复合词或代码片段中的命名子串。
const DEPRECATED_FIELDS = [
  {
    name: 'ending_type',
    reason: '2.3.0 大纲层戏剧力重构后被 value_shift 替代（OutlineStructure v3.0+ / ChapterMetadata v1.1+）',
  },
  {
    name: 'evaluation_focus',
    reason: '已从 ReviewReport schema 移除（continuity-editor 重构）',
  },
  {
    name: 'style_guidance',
    reason: '已从 WritingContextPack 移除，被 sentence_rhythm 等具体字段替代',
  },
  {
    name: 'style_reference',
    reason: '已从 WritingContextPack 移除，风格引用改由 novel-style-reference Skill 的 MCP 工具承载',
  },
  {
    name: 'recent_techniques',
    reason: '已被 previous_chapter_briefs[] / previous_chapter_anchors[] 取代（WritingContextPack v2.0+）',
  },
];

// =====================================================================
// 工具函数
// =====================================================================

/**
 * 列出目录下所有 .md 文件，可选递归。
 */
function listMarkdownFiles(dir, recursive) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...listMarkdownFiles(full, true));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * 加载所有 schema 真值：title → { version, file }。
 */
function loadSchemas() {
  const map = new Map();
  if (!fs.existsSync(SCHEMAS_DIR)) return map;
  for (const file of fs.readdirSync(SCHEMAS_DIR)) {
    if (!file.endsWith('.json')) continue;
    const full = path.join(SCHEMAS_DIR, file);
    try {
      const data = JSON.parse(fs.readFileSync(full, 'utf-8'));
      if (data.title && data.version) {
        map.set(data.title, {
          version: data.version,
          file: path.relative(REPO_ROOT, full),
        });
      }
    } catch (err) {
      console.error(`[warn] 解析 ${file} 失败: ${err.message}`);
    }
  }
  return map;
}

/**
 * 把语义版本号归一化到 "major.minor" 用于宽松比较。
 *   "2.1.0" → "2.1"
 *   "v2.1"  → "2.1"
 *   "1"     → "1.0"
 */
function normalizeVersion(raw) {
  const clean = raw.replace(/^v/i, '').trim();
  const parts = clean.split('.');
  if (parts.length === 1) return `${parts[0]}.0`;
  return `${parts[0]}.${parts[1]}`;
}

/**
 * 报告条目结构：
 *   { file, line, col, code, message }
 */
function makeReport(file, line, col, code, message) {
  return {
    file: path.relative(REPO_ROOT, file),
    line,
    col,
    code,
    message,
  };
}

/**
 * 计算「下一行被 ignore」的行号集合（1-based）。
 *
 * 触发条件：某一行（trim 后）包含 `drift-lint-ignore-next-line`，则其下一行
 * 的 1-based 行号被加入 ignore 集合。
 *
 * 多个连续 ignore 注释只会跳过紧邻的下一行（不级联）。
 */
function computeIgnoredLines(lines) {
  const ignored = new Set();
  const PATTERN = /drift-lint-ignore-next-line/;
  for (let i = 0; i < lines.length; i++) {
    if (PATTERN.test(lines[i])) {
      // i 是 0-based，下一行 0-based = i+1，1-based = i+2
      ignored.add(i + 2);
    }
  }
  return ignored;
}

// =====================================================================
// 检测项 A：版本号漂移
// =====================================================================

/**
 * 正则：捕获 `(SchemaTitle) v(major.minor)(.patch)?` 模式。
 * 用 lookbehind 确保左侧词整词匹配，但 JS regex 对 lookbehind 支持较弱时
 * 用 \b 也可——这里用 \b。
 */
const VERSION_PATTERN = /\b([A-Z][A-Za-z0-9]+)\s+v(\d+\.\d+)(\.\d+)?\b/g;

function scanVersionDrift(file, schemaMap) {
  const reports = [];
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  const ignoredLines = computeIgnoredLines(lines);

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    if (ignoredLines.has(lineNumber)) continue;
    const line = lines[i];
    let match;
    // reset lastIndex for global regex
    VERSION_PATTERN.lastIndex = 0;
    while ((match = VERSION_PATTERN.exec(line)) !== null) {
      const [full, title, majorMinor, patch] = match;
      if (!schemaMap.has(title)) continue; // 不是已知 schema 名，跳过

      const truth = schemaMap.get(title);
      const truthNormalized = normalizeVersion(truth.version);
      const refNormalized = normalizeVersion(majorMinor + (patch || ''));

      if (truthNormalized !== refNormalized) {
        const col = match.index + 1;
        reports.push(
          makeReport(
            file,
            lineNumber,
            col,
            'A:version-drift',
            `引用 "${full}" 与 schema 真值不一致（${truth.file} version=${truth.version}）。建议改为 ${title} v${truthNormalized}`,
          ),
        );
      }
    }
  }
  return reports;
}

// =====================================================================
// 检测项 B：已弃用字段引用
// =====================================================================

/**
 * 为每个弃用字段构造正则：\b<name>\b
 * 注意：JS \b 对 ASCII 友好，对 CJK 边界判断不可靠，但目标字段都是 snake_case
 * ASCII，故安全。
 */
const DEPRECATED_REGEX = DEPRECATED_FIELDS.map((f) => ({
  ...f,
  regex: new RegExp(`\\b${f.name}\\b`, 'g'),
}));

function scanDeprecatedFields(file) {
  const reports = [];
  const content = fs.readFileSync(file, 'utf-8');
  const lines = content.split('\n');
  const ignoredLines = computeIgnoredLines(lines);

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    if (ignoredLines.has(lineNumber)) continue;
    const line = lines[i];
    for (const field of DEPRECATED_REGEX) {
      field.regex.lastIndex = 0;
      let match;
      while ((match = field.regex.exec(line)) !== null) {
        const col = match.index + 1;
        reports.push(
          makeReport(
            file,
            lineNumber,
            col,
            'B:deprecated-field',
            `引用已弃用字段 "${field.name}"（${field.reason}）`,
          ),
        );
      }
    }
  }
  return reports;
}

// =====================================================================
// 主流程
// =====================================================================

function main() {
  const schemaMap = loadSchemas();
  if (schemaMap.size === 0) {
    console.error('[error] 未找到任何 schema（schemas/*.json）');
    process.exit(2);
  }

  // 收集待扫描文件
  const files = [];
  for (const target of SCAN_TARGETS) {
    files.push(...listMarkdownFiles(target.dir, target.recursive));
  }

  // 跑两项检测
  const versionReports = [];
  const deprecatedReports = [];
  for (const file of files) {
    versionReports.push(...scanVersionDrift(file, schemaMap));
    deprecatedReports.push(...scanDeprecatedFields(file));
  }

  // 输出
  const total = versionReports.length + deprecatedReports.length;

  if (versionReports.length > 0) {
    console.log('=== A. 版本号漂移 ===');
    for (const r of versionReports) {
      console.log(`${r.file}:${r.line}:${r.col}  [${r.code}] ${r.message}`);
    }
    console.log('');
  }

  if (deprecatedReports.length > 0) {
    console.log('=== B. 已弃用字段引用 ===');
    for (const r of deprecatedReports) {
      console.log(`${r.file}:${r.line}:${r.col}  [${r.code}] ${r.message}`);
    }
    console.log('');
  }

  // 汇总
  console.log('=== Summary ===');
  console.log(`扫描文件数: ${files.length}`);
  console.log(`已知 schema 数: ${schemaMap.size}（${[...schemaMap.keys()].join(', ')}）`);
  console.log(`版本号漂移: ${versionReports.length}`);
  console.log(`已弃用字段引用: ${deprecatedReports.length}`);
  console.log(`漂移总数: ${total}`);

  if (total > 0) {
    console.log('\n发现漂移，退出码 1');
    process.exit(1);
  } else {
    console.log('\n未发现漂移，退出码 0');
    process.exit(0);
  }
}

main();
