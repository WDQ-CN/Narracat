#!/usr/bin/env node
/**
 * provenance-lint
 * ===============
 *
 * 目标：保证「运行时 prompt」（agents/ + skills/** + commands/）出处中立——
 *       不携带 dev-provenance 标记（issue 号 / ADR 引用 / 里程碑标签）。
 *       溯源归维护者层（CLAUDE.md / docs/adr / CHANGELOG / git），不进运行时 prompt。
 *       决策见 docs/adr/0017-runtime-prompt-provenance-neutral-accepted.md。
 *
 * 扫描范围：agents/*.md、skills/**\/*.md（含 SKILL.md + references/*.md）、commands/*.md。
 *   不扫 docs/（维护者层，出处是其本职）、schemas/（非运行时注入）。
 *
 * 禁用模式（命中即 fail）：
 *   - issue 号        `#\d{2,4}`          如 "#227"
 *   - ADR 引用        `ADR-\d{4}`         如 "ADR-0016"
 *   - 里程碑(Goal)    `Goal [BC]`         如 "Goal B B5.1"
 *   - 里程碑(B 小数)  `\bB\d+\.\d`        如 "B5.1" "B4.1"（裸 B2/B3/B4 enum 不含小数，不误伤）
 *   - 里程碑(刀N)     `刀\d+`             如 "刀4" "刀12"（项目史"第 N 刀"迭代黑话；"一刀切""刀光"等
 *                                          正常中文词"刀"后不紧跟数字，不误伤）
 *   - dogfood 标记    `dogfood`           如 "B3 dogfood #133 触发新增"
 *
 * 故意不纳入（歧义 / 功能性，保留）：
 *   - 裸版本号 `vN`（如 "v3 数据" 指用户大纲代际，是运行时行为）
 *   - schema 版本戳 `vN.M` 由 schema-drift-lint 单独按真值校验，本 lint 不重复
 *   - 功能码：§X.X / GATE-N / W-N / 反模式码 A1-H2 / enum B2/B3/B4 / L1/L3 / MCP 工具名
 *
 * Ignore 机制（与 schema-drift-lint 同款）：
 *   在需保留出处的行上方加 `<!-- drift-lint-ignore-next-line -->`，扫描跳过紧邻下一行。
 *   运行时 prompt 正常不应需要它——仅留作极端历史说明的逃生舱。
 *
 * 输出：ESLint 风格 `file:line:col message` + summary。退出码：命中→1，否则→0。
 *
 * 用法：
 *   node scripts/provenance-lint.mjs        # 仓库根目录运行
 *   npm run lint:provenance                 # 通过根 package.json scripts 入口
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

// ----- 扫描目标（运行时 prompt 三层）-----
const SCAN_TARGETS = [
  { dir: path.join(REPO_ROOT, 'agents'), recursive: false },
  { dir: path.join(REPO_ROOT, 'skills'), recursive: true },
  { dir: path.join(REPO_ROOT, 'commands'), recursive: false },
];

// ----- 禁用模式 -----
export const BANNED = [
  { name: 'issue 号', re: /#\d{2,4}\b/, hint: 'issue 号属开发出处，移出运行时 prompt（溯源归 git/CHANGELOG）' },
  { name: 'ADR 引用', re: /ADR-\d{4}/, hint: 'ADR 引用属决策出处，移出运行时 prompt（溯源归 docs/adr）' },
  { name: '里程碑 Goal', re: /Goal [BC]\b/, hint: 'Goal 里程碑标签属开发出处，删除或重述为现在时规则' },
  { name: '里程碑 B 小数', re: /\bB\d+\.\d/, hint: 'B 小数里程碑（如 B5.1）属开发出处，删除（裸 B2/B3/B4 enum 不受限）' },
  {
    name: '里程碑 刀N',
    re: /刀\d+/,
    hint: '「刀N」迭代刀次编号（如刀4、刀12）属开发出处，删除或重述为现在时规则（溯源归 progress.md/CHANGELOG，"一刀切""刀光"等正常中文词不受限）',
  },
  { name: 'dogfood 标记', re: /dogfood/, hint: 'dogfood 触发标记属开发出处，删除' },
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

/**
 * 对给定扫描目标跑 provenance 规则，返回 findings（不含 file 相对路径的 base，由调用方传入 root 用于相对化）。
 * @param {{dir: string, recursive: boolean}[]} scanTargets
 * @param {string} root 用于把绝对路径相对化的根目录（默认 REPO_ROOT）
 */
export function lintProvenance(scanTargets = SCAN_TARGETS, root = REPO_ROOT) {
  const findings = [];
  for (const target of scanTargets) {
    for (const file of listMarkdownFiles(target.dir, target.recursive)) {
      const rel = path.relative(root, file);
      const lines = fs.readFileSync(file, 'utf-8').split('\n');
      let ignoreNext = false;
      lines.forEach((line, i) => {
        const skip = ignoreNext;
        ignoreNext = line.includes(IGNORE_MARKER);
        if (skip) return;
        for (const rule of BANNED) {
          const m = rule.re.exec(line);
          if (m) {
            findings.push({
              file: rel,
              line: i + 1,
              col: m.index + 1,
              rule: rule.name,
              match: m[0],
              hint: rule.hint,
            });
          }
        }
      });
    }
  }
  return findings;
}

// 主模块判断用 pathToFileURL：裸 file://+argv[1] 在路径含空格/转义字符时与 import.meta.url 不等，
// 会让 CLI 分支静默不执行、exit 0（护栏无声失效）。
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const findings = lintProvenance();

  if (findings.length === 0) {
    console.log('✓ provenance-lint: 运行时 prompt 出处中立，未发现 dev-provenance 标记');
    process.exit(0);
  }

  console.error('✗ provenance-lint: 运行时 prompt 中发现 dev-provenance 标记\n');
  for (const f of findings) {
    console.error(`${f.file}:${f.line}:${f.col}  [${f.rule}] "${f.match}" — ${f.hint}`);
  }
  console.error(`\n=== Summary ===\n命中 ${findings.length} 处。`);
  console.error('修复：删除出处标记，或把"历史上 X、ADR-N 后变 Y"重述为现在时规则。');
  console.error('保留例外（功能码）：§X.X / GATE-N / W-N / 反模式码 / enum B2-B4 / L1-L3 / MCP 工具名。');
  process.exit(1);
}
