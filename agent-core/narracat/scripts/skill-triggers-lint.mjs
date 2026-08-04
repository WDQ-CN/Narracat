#!/usr/bin/env node
/**
 * skill-triggers-lint — 按需调用型 Skill 的触发点声明规范检查
 * =========================================================
 *
 * 背景：Skill 有两种挂载语义。预加载型写入 subagent `skills:` 字段 eager 全量注入；
 *       按需调用型保留 Skill 工具按需加载，并向消费方注入「遇 X 调 Y」触发提示。
 *       弱模型（deepseek）下按需触发是软保证，须靠触发点双写硬化——而双写的来源是
 *       Skill 自己声明的触发点。本 lint 保证：任何声明为按需型的 Skill 都带触发点，
 *       否则消费方侧无内容可渲染，按需挂载静默漏调。
 *
 * 声明位置与字段格式（单一来源 = SKILL.md frontmatter）：
 *   - `mount-mode: on-demand`  把该 Skill 标记为按需挂载型（缺省 = 预加载型，不受本 lint 约束）。
 *   - `triggers:`              触发点列表（YAML 数组），每条描述「在什么场景应调用该 Skill」。
 *
 * 校验规则：
 *   - 声明 `mount-mode: on-demand` 但缺 `triggers` 或 triggers 为空 → error（指明 Skill）。
 *   - 未声明 `mount-mode: on-demand`（含完全没有该字段）→ 跳过（现有 6 个内置 Skill 均如此，不被误伤）。
 *   - `mount-mode` 取值非 `preload` / `on-demand` → error（防拼写错误静默放行）。
 *
 * 输出：ESLint 风格 `file message` + summary。退出码：命中 error → 1，否则 → 0。
 *
 * 用法：
 *   node scripts/skill-triggers-lint.mjs   # agent-core/narracat 目录运行
 *   npm run lint:skill-triggers            # 通过 package.json scripts 入口
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const VALID_MOUNT_MODES = new Set(['preload', 'on-demand']);

/** 极简 frontmatter 提取：取首个 --- ... --- 块原文（不解析整文档） */
export function extractFrontmatter(content) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  return match ? match[1] : null;
}

/**
 * 从 frontmatter 原文解析触发点声明所需字段，避免引入 YAML 依赖（lint 零 runtime 依赖纪律）。
 * 仅识别本 lint 关心的两字段：`mount-mode:` 标量、`triggers:` 列表（YAML block 序列）。
 */
export function parseTriggerDeclaration(frontmatter) {
  if (typeof frontmatter !== 'string') return { mountMode: null, triggers: [] };

  const lines = frontmatter.split(/\r?\n/);
  let mountMode = null;
  const triggers = [];
  let inTriggers = false;

  for (const line of lines) {
    const mountMatch = /^mount-mode:\s*(.+?)\s*$/.exec(line);
    if (mountMatch) {
      mountMode = mountMatch[1].replace(/^["']|["']$/g, '').trim();
      inTriggers = false;
      continue;
    }

    if (/^triggers:\s*$/.test(line)) {
      inTriggers = true;
      continue;
    }

    // triggers 写成行内数组：triggers: [a, b]
    const inlineTriggers = /^triggers:\s*\[(.*)\]\s*$/.exec(line);
    if (inlineTriggers) {
      for (const item of inlineTriggers[1].split(',')) {
        const value = item.replace(/^["']|["']$/g, '').trim();
        if (value) triggers.push(value);
      }
      inTriggers = false;
      continue;
    }

    if (inTriggers) {
      const itemMatch = /^\s*-\s+(.+?)\s*$/.exec(line);
      if (itemMatch) {
        const value = itemMatch[1].replace(/^["']|["']$/g, '').trim();
        if (value) triggers.push(value);
        continue;
      }
      // 遇到非缩进列表行（下一个顶层键）→ triggers 块结束
      if (line.trim() && !/^\s/.test(line)) inTriggers = false;
    }
  }

  return { mountMode, triggers };
}

/** 列出 skills/ 下每个子目录的 SKILL.md 路径 */
function listSkillFiles(skillsDir) {
  if (!fs.existsSync(skillsDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillMd = path.join(skillsDir, entry.name, 'SKILL.md');
    if (fs.existsSync(skillMd)) out.push({ name: entry.name, file: skillMd });
  }
  return out;
}

/**
 * 纯函数：扫描 skills 目录，返回 findings 列表（可测试，无 IO 副作用之外的状态）。
 * finding: { skill, file, message }
 */
export function lintSkillTriggers(skillsDir) {
  const findings = [];
  for (const { name, file } of listSkillFiles(skillsDir)) {
    const frontmatter = extractFrontmatter(fs.readFileSync(file, 'utf-8'));
    const { mountMode, triggers } = parseTriggerDeclaration(frontmatter);

    if (mountMode === null) continue; // 缺省预加载型，不受约束

    if (!VALID_MOUNT_MODES.has(mountMode)) {
      findings.push({
        skill: name,
        file,
        message: `mount-mode 取值非法："${mountMode}"，只允许 preload / on-demand`,
      });
      continue;
    }

    if (mountMode === 'on-demand' && triggers.length === 0) {
      findings.push({
        skill: name,
        file,
        message: '声明为按需挂载型（mount-mode: on-demand）但缺触发点：须在 frontmatter 加非空 triggers 列表',
      });
    }
  }
  return findings;
}

// ---- CLI 入口（被 import 时不执行）----
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const skillsDir = path.join(repoRoot, 'skills');
  const findings = lintSkillTriggers(skillsDir);

  if (findings.length === 0) {
    console.log('✓ skill-triggers-lint: 按需挂载型 Skill 均已声明触发点');
    process.exit(0);
  }

  console.error('✗ skill-triggers-lint: 发现按需挂载型 Skill 缺触发点声明\n');
  for (const f of findings) {
    console.error(`${path.relative(repoRoot, f.file)}  [${f.skill}] — ${f.message}`);
  }
  console.error(`\n=== Summary ===\n命中 ${findings.length} 处。`);
  console.error('修复：在 SKILL.md frontmatter 为按需型 Skill 补 triggers 列表（每条描述「在什么场景应调用该 Skill」）。');
  process.exit(1);
}
