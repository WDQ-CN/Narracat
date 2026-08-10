export type NarraCatContractStatus = 'ready' | 'invalid'

export interface NarraCatContractCheck {
  id: string
  label: string
  ok: boolean
  detail?: string
}

export interface NarraCatAgentCoreVersionLock {
  path: string
  name: string
  version: string
  manifestPath: string
  upstream?: {
    repo: string
    commit: string
    manifestVersion: string
  }
  acceptedImport?: {
    stage: string
    issue: string
    acceptedAt: string
    sourcePath: string
  }
  updateCommand: string
  checkCommand: string
}

export interface NarraCatAgentCoreDiagnostics {
  status: NarraCatContractStatus
  agentCorePath: string
  name?: string
  version?: string
  expectedVersion: string
  versionLock: NarraCatAgentCoreVersionLock
  checks: NarraCatContractCheck[]
  errors: string[]
  /** 各 agent frontmatter 声明的 skills（agent id → skill 名数组），从 SSOT 读取供 UI 展示 */
  agentSkills: Record<string, string[]>
  /** Agent Core 已安装的全部内置 Skill（存在性全集），用于 stale 过滤与展示 */
  availableSkills: string[]
  /** 按 Agent 绑定的可挂载 Skill 集（agentId → 该 Agent 可挂的 Skill 名数组）。
   *  来源是 SKILL.md frontmatter `mount-agents: [agent-id, ...]`——同一 Skill 对不同 Agent 可呈现为可挂或不出现。
   *  每个内置 Agent 一律有键（无人声明时为空数组）。**Skill 挂载 UI 已整体退役（ADR-0020 2026-08-07 补记），
   *  当前无消费者**——这是纯诊断字段，保留供 issue #510（官方 Skill 是否真到达模型）实证结论出来前继续观察。 */
  mountableSkillsByAgent: Record<string, string[]>
  /** 各 Skill 的 SKILL.md token 体量估算（skillId → token）。原为预加载预算护栏计算所用，
   *  该护栏随挂载 UI 一并退役；当前无消费者，保留供 #510。 */
  skillTokenEstimates: Record<string, number>
  /** 各 Skill frontmatter 声明的触发点（skillId → 触发场景数组，#260 规范），仅按需型有。原为按需挂载
   *  触发提示所用，该 UI 已退役；当前无消费者，保留供 #510。 */
  skillTriggers: Record<string, string[]>
}

// ── Embedding 向量健康诊断（#320）─────────────────────────────────────────
// embedding 模型曾静默失效（#312）：模型加载失败 → 向量从未写入 → hybrid 检索一直
// 降级为纯 FTS，且无肉眼可见信号。下列类型支撑「一键体检」把降级变成可见结论。

export type EmbeddingModelSourceKind = 'bundled-offline' | 'on-demand-download' | 'missing'

/** 模型来源解析：内置离线包 / 按需下载 / 未找到（含已检查的候选根目录） */
export interface EmbeddingModelSource {
  kind: EmbeddingModelSourceKind
  modelPath?: string
  candidates: string[]
}

export interface EmbeddingHealthCheckStep {
  ok: boolean
  detail?: string
  error?: string
}

/**
 * 引擎自检脚本（mcp-server/src/embedding-selftest.ts）的输出契约，本接口须与之镜像。
 * 四项全链路：模型加载 / 向量生成 / sqlite-vec 扩展 / 检索往返。
 */
export interface EmbeddingSelfTestReport {
  ok: boolean
  modelLoad: EmbeddingHealthCheckStep & { modelName?: string; dim?: number }
  embed: EmbeddingHealthCheckStep & { dim?: number; normalized?: boolean; durationMs?: number }
  sqliteVec: EmbeddingHealthCheckStep
  retrieval: EmbeddingHealthCheckStep & { hit?: boolean; topDistance?: number }
}

/** 自检子进程的原始执行诊断（spawn 失败 / 超时 / 退出码） */
export interface EmbeddingProbeProcessInfo {
  ok: boolean
  command: string
  args: string[]
  stdout: string
  stderr: string
  exitCode: number | null
  signal: string | null
  error?: string
}

/** App 侧 embedding 健康探针结果（IPC 返回体） */
export interface EmbeddingHealthProbeResult {
  ok: boolean
  /** true = 语义检索降级为纯 FTS（与 ok 互补，便于 UI 直接判定） */
  degraded: boolean
  checkedAt: string
  /** 一句话结论：「向量语义检索正常」或「降级为纯 FTS（原因…）」 */
  summary: string
  modelSource: EmbeddingModelSource
  selfTest: EmbeddingSelfTestReport | null
  process: EmbeddingProbeProcessInfo
}

// ── 语料服务连通性体检（设置页体检卡，spec: docs/superpowers/specs/2026-08-05-corpus-server-design.md）─────
// disabled=未配置凭证（fork 默认态，写作不注入范例）；local=维护者开发态本地语料目录；remote=打包发行态联网探测。
export interface CorpusHealthProbeResult {
  ok: boolean
  mode: 'remote' | 'local' | 'disabled'
  summary: string
  totalEntries?: number
}

export type NarraCatArtifactKind = 'outline' | 'manuscript' | 'context-pack' | 'review' | 'deep-review'
