import { createHash } from 'node:crypto'
import { readFile, readdir, realpath } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { resolveLightModel, resolvePrimaryModel } from '@shared/lib/model-slots'
import type { AppConfig } from '../../config.ts'
import { resolveNovelAgentsGuide } from '../runtime/novel-agents-guide.ts'

export const AGENT_SESSION_CONTRACT_REVISION = 1

export interface AgentSessionFingerprintInput {
  config: AppConfig
  projectId?: string
  projectPath?: string
  mode: 'direct' | 'project-command'
  loadNarraCatRuntime: boolean
  maxTurns?: number
  allowedTools?: string[]
  /** 本次 run 的 runtime 标识（adapter id）：切 runtime 必须触发会话失效，session id 不跨 runtime 复用。 */
  runtimeId: 'claude-sdk' | 'pi'
  agentCoreVersion: string
  skillMountStorePath?: string
  userDataPath?: string
}

async function readOptionalFile(path: string | undefined): Promise<string> {
  if (!path) return ''
  return readFile(path, 'utf8').catch(() => '')
}

async function hashDirectory(root: string | undefined): Promise<string> {
  if (!root) return ''
  const rootPath = root
  const hash = createHash('sha256')

  async function visit(directory: string): Promise<void> {
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile()) {
        hash.update(relative(rootPath, path).normalize('NFC'))
        hash.update('\0')
        hash.update(await readFile(path).catch(() => Buffer.alloc(0)))
        hash.update('\0')
      }
    }
  }

  await visit(rootPath)
  return hash.digest('hex')
}

export async function createAgentSessionCompatibilityFingerprint(
  input: AgentSessionFingerprintInput,
): Promise<string> {
  const canonicalProjectPath = input.projectPath
    ? await realpath(input.projectPath).catch(() => resolve(input.projectPath!))
    : undefined
  const skillMounts = await readOptionalFile(input.skillMountStorePath)
  const userSkillIndex = await readOptionalFile(
    input.userDataPath ? join(input.userDataPath, 'user-skills.json') : undefined,
  )
  const userSkillContentHash = await hashDirectory(
    input.userDataPath ? join(input.userDataPath, 'user-skills') : undefined,
  )
  const novelAgentsGuide = (await resolveNovelAgentsGuide(input.projectPath)) ?? ''
  const primary = resolvePrimaryModel(input.config)
  const light = resolveLightModel(input.config)
  const normalized = {
    projectId: input.projectId?.trim() || null,
    projectPath: canonicalProjectPath?.normalize('NFC') ?? null,
    // 模型池化：指纹绑定「解析后的主力/轻量」而非整份池——池增删不影响会话，切槽位才断
    primaryModel: primary ? { provider: primary.provider, baseUrl: primary.baseUrl, modelId: primary.modelId } : null,
    lightModel: light ? { provider: light.provider, modelId: light.modelId } : null,
    apiKeyGeneration: primary ? (input.config.apiKeyMetadata[primary.provider]?.updatedAt ?? null) : null,
    agentCoreVersion: input.agentCoreVersion,
    sessionContractRevision: AGENT_SESSION_CONTRACT_REVISION,
    skillMounts,
    userSkillIndex,
    userSkillContentHash,
    novelAgentsGuide,
    mode: input.mode,
    loadNarraCatRuntime: input.loadNarraCatRuntime,
    maxTurns: input.maxTurns ?? null,
    allowedTools: [...(input.allowedTools ?? [])].sort(),
    runtimeId: input.runtimeId,
  }
  return createHash('sha256').update(JSON.stringify(normalized), 'utf8').digest('hex')
}
