// sweepStaleUserSkillCopies：阶段2切片④删掉用户 Skill 文件搬运链（原同步模块）后的收尾
// （评审 task-6-review.md Important#2）。
//
// 背景：被删的搬运链自带一份「崩溃残留自愈」——下次 run 时用标记文件识别「上次 run 崩溃没清干净的
// 本插件副本」，清掉重铺。删链后该自愈路径消失，但 SDK 侧 `cwd: projectPath` + `settingSources:
// ['project']` 仍会扫 `<projectPath>/.claude/skills/`，老项目里若存在带标记的残留目录，会继续被
// 当作项目级 skill 发现，且与挂载/卸载状态彻底脱钩（UI 卸载了也清不掉），成为幽灵。
//
// 本模块只做最小的那部分：run 前 best-effort 删掉带标记的残留目录，不写、不铺、不复活整条同步链。
// 判定与已退役的搬运链一致：带 `.narracat-user-skill` 标记 = 本插件曾经复制进来的
// 临时副本 → 删；无标记 = 作者自己的项目级 skill → 绝不碰、绝不清理。
//
// 降级纪律：目录不存在 / 不可读 → 静默返回（无残留，正常态，绝大多数 run 会走这条）。单条子目录的
// stat/rm 失败只跳过该条，不阻断其余项，也不阻断 run。

import { readdir, rm, stat } from 'node:fs/promises'
import type { Dirent } from 'node:fs'
import { join } from 'node:path'

/** 注入文件操作的依赖面（默认即真实 fs）：仅为隔离测试而存在，生产走默认。 */
export interface SweepStaleUserSkillCopiesFs {
  readdir: (path: string, options: { withFileTypes: true }) => Promise<Dirent[]>
  stat: typeof stat
  rm: typeof rm
}

const DEFAULT_FS: SweepStaleUserSkillCopiesFs = { readdir, stat, rm }

/** 本插件临时副本的标记文件名（与已退役的搬运链同名，兼容其遗留残留） */
const USER_SKILL_MARKER = '.narracat-user-skill'

async function isOwnedTempSkill(fs: SweepStaleUserSkillCopiesFs, dir: string): Promise<boolean> {
  try {
    return (await fs.stat(join(dir, USER_SKILL_MARKER))).isFile()
  } catch {
    return false
  }
}

/**
 * 扫 `<projectPath>/.claude/skills/` 一层子目录，删掉带标记的（崩溃残留），跳过无标记的（作者资产）。
 * best-effort：任一环节失败静默吞掉，不抛、不阻断 run。
 */
export async function sweepStaleUserSkillCopies(
  projectPath: string,
  fs: SweepStaleUserSkillCopiesFs = DEFAULT_FS,
): Promise<void> {
  const skillsRoot = join(projectPath, '.claude', 'skills')
  let entries: Dirent[]
  try {
    entries = await fs.readdir(skillsRoot, { withFileTypes: true })
  } catch {
    return // 目录不存在 / 不可读 → 无残留，静默返回
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(skillsRoot, entry.name)
    if (!(await isOwnedTempSkill(fs, dir))) continue // 无标记：作者自己的项目级 skill，绝不碰
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
