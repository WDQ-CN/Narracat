// 官方 Skill 正文只读读取（ADR-0020 约束 1 的「不可查看」半条已被推翻，见
// docs/superpowers/specs/2026-08-06-agent-prose-user-editing-design.md §2.3）：
// 开源后 SKILL.md 在 GitHub 上人人可读，App 内继续隐藏只剩害处——作者在产品里看不到、
// 去仓库能看到，反而更困惑，且白白削弱「引擎透明」这一开源卖点。
//
// 「不可编辑」继续成立（§2.4：pi 底座下官方 Skill 靠 Read 磁盘文件到达模型，内存 override 不生效），
// 故本模块只读，不提供任何写路径。

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PROSE_BLOCK_ID_RE } from '@shared/lib/prose-blocks'
import { relativizeEngineRoot } from './engine-path-vars.ts'

function stripFrontmatter(content: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(content)
  return (match ? content.slice(match[0].length) : content).trim()
}

/**
 * 读某官方 Skill 的 SKILL.md 正文。读不到一律返回空串，由渲染端友好提示，绝不抛。
 *
 * skillId 用严格白名单（kebab-case，与块 id 同值域）而非黑名单：IPC 是信任边界，
 * 黑名单挡不住 '..' 这类会走出 skills/ 目录的裸名。
 *
 * 正文里的引擎路径变量走**相对化**（不是展开成绝对路径）：作者要的信息是「这是引擎里的哪个
 * 文件」，绝对路径对他是纯噪音，而且带着本机用户名与目录结构——作者截图求助时会一并泄露。
 * 模型那边另走 expandEngineRoot 拿绝对路径，两种语义不共用，见 engine-path-vars.ts。
 */
export async function readOfficialSkillBody(input: {
  agentCorePath: string
  skillId: string
}): Promise<string> {
  const skillId = input.skillId?.trim() ?? ''
  if (!skillId || !PROSE_BLOCK_ID_RE.test(skillId)) return ''
  try {
    const content = await readFile(join(input.agentCorePath, 'skills', skillId, 'SKILL.md'), 'utf-8')
    return relativizeEngineRoot(stripFrontmatter(content))
  } catch {
    return ''
  }
}
