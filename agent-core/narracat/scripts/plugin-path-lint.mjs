#!/usr/bin/env node
/**
 * plugin-path-lint
 * ================
 *
 * 目标：保证「运行时 prompt」（agents/ + skills/** + commands/）中对 plugin 内静态资源的
 *       引用一律带 `${CLAUDE_PLUGIN_ROOT}/` 前缀——主会话与 subagent 执行时 cwd 是用户
 *       小说项目目录，裸相对路径会读不到 plugin 内文件（首次 Read 失败 → Glob 降级自救
 *       浪费 token，或静默走"缺数据降级"导致核心算法失效，2.5.2 hotfix 教训）。
 *
 * 扫描范围：agents/*.md、skills/**\/*.md（含 SKILL.md + references/ 子文件）、commands/*.md。
 *   不扫 docs/（维护者层）、schemas/（非运行时注入）、mcp-server/。
 *
 * 校验的资源路径类别（命中且前缀不合法即 fail）：
 *   - `references/...`     合法前缀：`${CLAUDE_PLUGIN_ROOT}/skills/<skill-name>/`
 *                          豁免：`bible/references/...`（小说项目内的参考作品目录，非 plugin 资源）
 *   - `docs/contracts/...` 合法前缀：`${CLAUDE_PLUGIN_ROOT}/`
 *   - `templates/...`      合法前缀：`${CLAUDE_PLUGIN_ROOT}/`
 *
 * 不误伤的设计：
 *   - `references/` 后必须紧跟 [A-Za-z0-9_*<] 才视为路径引用；
 *     「references/ 子文件」「references/ 物理重复同步」这类目录概念叙述（斜杠后是空格/中文/标点）不命中。
 *
 * Ignore 机制（与 schema-drift-lint 同款）：
 *   在需豁免的行上方加 `<!-- drift-lint-ignore-next-line -->`，扫描跳过紧邻下一行。
 *   运行时 prompt 正常不应需要它——仅留作极端情况的逃生舱。
 *
 * 输出：ESLint 风格 `file:line:col message` + summary。退出码：命中→1，否则→0。
 *
 * 用法：
 *   node scripts/plugin-path-lint.mjs        # 仓库根目录运行
 *   npm run lint:plugin-paths                # 通过根 package.json scripts 入口
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ----- 扫描目标（运行时 prompt 三层）-----
const SCAN_TARGETS = [
  { dir: path.join(REPO_ROOT, 'agents'), recursive: false },
  { dir: path.join(REPO_ROOT, 'skills'), recursive: true },
  { dir: path.join(REPO_ROOT, 'commands'), recursive: false },
];

// ----- 资源路径规则 -----
// match: 资源路径标记（全局正则）；
// follow: 命中后紧跟字符须满足（不满足视为目录概念叙述，跳过）；
// validPrefix: 命中位置之前的文本须以此正则结尾才合法；
// exemptPrefix: 命中位置之前的文本以此正则结尾时豁免（非 plugin 资源）。
const RULES = [
  {
    name: 'skill references 资源',
    match: /references\//g,
    follow: /[A-Za-z0-9_*<]/,
    validPrefix: /\$\{CLAUDE_PLUGIN_ROOT\}\/skills\/[A-Za-z0-9_-]+\/$/,
    exemptPrefix: /bible\/$/,
    hint: '加 `${CLAUDE_PLUGIN_ROOT}/skills/<skill-name>/` 前缀（bible/references/ 是小说项目目录，不受限）',
  },
  {
    name: '共享契约',
    match: /docs\/contracts\//g,
    follow: /[A-Za-z0-9_]/,
    validPrefix: /\$\{CLAUDE_PLUGIN_ROOT\}\/$/,
    exemptPrefix: null,
    hint: '加 `${CLAUDE_PLUGIN_ROOT}/` 前缀',
  },
  {
    name: '模板资源',
    match: /templates\//g,
    follow: /[A-Za-z0-9_]/,
    validPrefix: /\$\{CLAUDE_PLUGIN_ROOT\}\/$/,
    exemptPrefix: null,
    hint: '加 `${CLAUDE_PLUGIN_ROOT}/` 前缀',
  },
];

const IGNORE_MARKER = 'drift-lint-ignore-next-line';

function listMarkdownFiles(dir, recursive) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (recursive) out.push(...listMarkdownFiles(full, true));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

const findings = [];

for (const target of SCAN_TARGETS) {
  for (const file of listMarkdownFiles(target.dir, target.recursive)) {
    const rel = path.relative(REPO_ROOT, file);
    const lines = fs.readFileSync(file, 'utf-8').split('\n');
    let ignoreNext = false;
    lines.forEach((line, i) => {
      const skip = ignoreNext;
      ignoreNext = line.includes(IGNORE_MARKER);
      if (skip) return;
      for (const rule of RULES) {
        rule.match.lastIndex = 0;
        let m;
        while ((m = rule.match.exec(line)) !== null) {
          const before = line.slice(0, m.index);
          const after = line.slice(m.index + m[0].length);
          // 斜杠后不是路径字符 → 目录概念叙述，跳过
          if (!rule.follow.test(after.charAt(0))) continue;
          // 已带合法前缀 → 通过
          if (rule.validPrefix.test(before)) continue;
          // 豁免前缀（如 bible/）→ 跳过
          if (rule.exemptPrefix && rule.exemptPrefix.test(before)) continue;
          findings.push({
            file: rel,
            line: i + 1,
            col: m.index + 1,
            rule: rule.name,
            match: m[0] + after.slice(0, 40).split(/[\s`」)】"']/)[0],
            hint: rule.hint,
          });
        }
      }
    });
  }
}

if (findings.length === 0) {
  console.log('✓ plugin-path-lint: 运行时 prompt 中 plugin 资源引用全部带 ${CLAUDE_PLUGIN_ROOT}/ 前缀');
  process.exit(0);
}

console.error('✗ plugin-path-lint: 运行时 prompt 中发现裸 plugin 资源路径\n');
for (const f of findings) {
  console.error(`${f.file}:${f.line}:${f.col}  [${f.rule}] "${f.match}" — ${f.hint}`);
}
console.error(`\n=== Summary ===\n命中 ${findings.length} 处。`);
console.error('原因：主会话与 subagent 的 cwd 是用户小说项目，裸相对路径读不到 plugin 内文件。');
console.error('修复：按 hint 加前缀；bible/references/（小说项目参考作品目录）不受限。');
process.exit(1);
