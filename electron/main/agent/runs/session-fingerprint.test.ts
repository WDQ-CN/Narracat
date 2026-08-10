import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppConfig } from '../../config.ts'
import { POOL_DEFAULT_FIELDS } from '@shared/types/config'
import { createAgentSessionCompatibilityFingerprint } from './session-fingerprint.ts'
import { sessionFingerprint } from './run-options.ts'

const config: AppConfig = {
  ...POOL_DEFAULT_FIELDS,
  apiKeyMetadata: {
    deepseek: { updatedAt: '2026-07-24T10:00:00.000Z' },
  },
  novelRootDir: '/novels',
  recentNovelPaths: [],
  introVersion: 0,
  systemNotificationsEnabled: true,
}

describe('agent session compatibility fingerprint', () => {
  test('changes for provider generation, runtime mode, and project path without reading API key plaintext', async () => {
    const root = await mkdtemp(join(tmpdir(), 'narracat-session-fingerprint-'))
    const projectPath = join(root, 'novel')
    await mkdir(projectPath, { recursive: true })

    const baseInput = {
      config,
      projectId: 'novel-1',
      projectPath,
      mode: 'project-command' as const,
      loadNarraCatRuntime: true,
      maxTurns: 72,
      allowedTools: ['Read', 'Write'],
      runtimeId: 'claude-sdk' as const,
      agentCoreVersion: '1.0.0',
    }
    const first = await createAgentSessionCompatibilityFingerprint(baseInput)
    expect(first).toHaveLength(64)

    const generationChanged = await createAgentSessionCompatibilityFingerprint({
      ...baseInput,
      config: {
        ...config,
        apiKeyMetadata: { deepseek: { updatedAt: '2026-07-24T11:00:00.000Z' } },
      },
    })
    const modeChanged = await createAgentSessionCompatibilityFingerprint({
      ...baseInput,
      mode: 'direct',
      loadNarraCatRuntime: false,
    })
    const runtimeChanged = await createAgentSessionCompatibilityFingerprint({
      ...baseInput,
      runtimeId: 'pi',
    })

    expect(generationChanged).not.toBe(first)
    expect(modeChanged).not.toBe(first)
    expect(runtimeChanged).not.toBe(first)
  })

  test('fallback hash (no injected fingerprint fn) also varies by runtime id', async () => {
    const context = { mode: 'direct' as const, loadNarraCatRuntime: false }
    const sdk = await sessionFingerprint(config, 'claude-sdk', context)
    const pi = await sessionFingerprint(config, 'pi', context)
    expect(sdk).not.toBe(pi)
  })

  test('切换 primaryModelKey → 指纹变（模型池化：指纹绑定解析后的主力槽）', async () => {
    const poolConfig: AppConfig = {
      ...config,
      modelPool: [
        { provider: 'deepseek', modelId: 'deepseek-v4-pro', verification: null },
        { provider: 'deepseek', modelId: 'deepseek-lite', verification: null },
      ],
      primaryModelKey: 'deepseek/deepseek-v4-pro',
    }
    const baseInput = {
      config: poolConfig,
      mode: 'direct' as const,
      loadNarraCatRuntime: false,
      runtimeId: 'pi' as const,
      agentCoreVersion: '1.0.0',
    }
    const before = await createAgentSessionCompatibilityFingerprint(baseInput)
    const after = await createAgentSessionCompatibilityFingerprint({
      ...baseInput,
      config: { ...poolConfig, primaryModelKey: 'deepseek/deepseek-lite' },
    })
    expect(after).not.toBe(before)
  })

  test('小说根 AGENTS.md 从无到有写入 → 指纹变（精准注入内容纳入指纹）', async () => {
    const root = await mkdtemp(join(tmpdir(), 'narracat-session-fingerprint-agents-'))
    const projectPath = join(root, 'novel')
    await mkdir(projectPath, { recursive: true })
    const baseInput = {
      config,
      mode: 'direct' as const,
      loadNarraCatRuntime: true,
      runtimeId: 'pi' as const,
      agentCoreVersion: '1.0.0',
      projectPath,
    }
    const before = await createAgentSessionCompatibilityFingerprint(baseInput)
    await writeFile(join(projectPath, 'AGENTS.md'), '本书写作说明 v1\n')
    const after = await createAgentSessionCompatibilityFingerprint(baseInput)
    expect(after).not.toBe(before)
  })

  test('无 AGENTS.md 时 CLAUDE.md 回退内容变化 → 指纹同样变', async () => {
    const root = await mkdtemp(join(tmpdir(), 'narracat-session-fingerprint-claude-md-'))
    const projectPath = join(root, 'novel')
    await mkdir(projectPath, { recursive: true })
    await writeFile(join(projectPath, 'CLAUDE.md'), '存量书说明 v1\n')
    const baseInput = {
      config,
      mode: 'direct' as const,
      loadNarraCatRuntime: true,
      runtimeId: 'pi' as const,
      agentCoreVersion: '1.0.0',
      projectPath,
    }
    const before = await createAgentSessionCompatibilityFingerprint(baseInput)
    await writeFile(join(projectPath, 'CLAUDE.md'), '存量书说明 v2\n')
    const after = await createAgentSessionCompatibilityFingerprint(baseInput)
    expect(after).not.toBe(before)
  })

  test('池加一条不占槽的条目 → 指纹不变（池增删不影响会话，切槽位才断）', async () => {
    const poolConfig: AppConfig = {
      ...config,
      modelPool: [{ provider: 'deepseek', modelId: 'deepseek-v4-pro', verification: null }],
      primaryModelKey: 'deepseek/deepseek-v4-pro',
    }
    const baseInput = {
      config: poolConfig,
      mode: 'direct' as const,
      loadNarraCatRuntime: false,
      runtimeId: 'pi' as const,
      agentCoreVersion: '1.0.0',
    }
    const before = await createAgentSessionCompatibilityFingerprint(baseInput)
    const after = await createAgentSessionCompatibilityFingerprint({
      ...baseInput,
      config: {
        ...poolConfig,
        modelPool: [...poolConfig.modelPool, { provider: 'glm', modelId: 'glm-5.2', verification: null }],
      },
    })
    expect(after).toBe(before)
  })
})
