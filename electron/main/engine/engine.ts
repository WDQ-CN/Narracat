import { existsSync } from 'node:fs'
import { join } from 'node:path'

type EngineSource = 'env' | 'packaged-resource' | 'agent-core-source' | 'fallback'
type FileExists = (path: string) => boolean
const AGENT_CORE_SOURCE_DIR = join('agent-core', 'narracat')
const PACKAGED_AGENT_CORE_DIR = 'NarraCatAgentCore'

export interface NarraCatEngine {
  agentCorePath: string
  source: EngineSource
}

export interface ResolveNarraCatEngineOptions {
  appRoot: string
  resourcesPath?: string
  envPath?: string
  fileExists?: FileExists
}

export type ResolveNarraCatAgentCorePathOptions = ResolveNarraCatEngineOptions

function manifestPath(agentCorePath: string): string {
  return join(agentCorePath, 'narracat.manifest.json')
}

function hasManifest(agentCorePath: string, fileExists: FileExists): boolean {
  return fileExists(manifestPath(agentCorePath))
}

function candidate(agentCorePath: string, source: EngineSource): NarraCatEngine {
  return { agentCorePath, source }
}

function nonEmptyPath(path: string | undefined): path is string {
  return Boolean(path?.trim())
}

function isPackagedAppRoot(appRoot: string, resourcesPath?: string): boolean {
  return Boolean(resourcesPath && appRoot === join(resourcesPath, 'app.asar'))
}

function engineCandidates(appRoot: string, resourcesPath?: string): NarraCatEngine[] {
  const appResource = candidate(join(appRoot, AGENT_CORE_SOURCE_DIR), 'agent-core-source')
  const packagedResource = resourcesPath ? candidate(join(resourcesPath, PACKAGED_AGENT_CORE_DIR), 'packaged-resource') : undefined
  const resourceCandidates = isPackagedAppRoot(appRoot, resourcesPath)
    ? [packagedResource, appResource]
    : [appResource, packagedResource]

  return resourceCandidates.filter((value): value is NarraCatEngine => Boolean(value))
}

export function resolveNarraCatEngine({
  appRoot,
  resourcesPath,
  envPath = '',
  fileExists = existsSync,
}: ResolveNarraCatEngineOptions): NarraCatEngine {
  if (nonEmptyPath(envPath)) return candidate(envPath, 'env')

  const candidates = engineCandidates(appRoot, resourcesPath)
  const resolved = candidates.find((engine) => hasManifest(engine.agentCorePath, fileExists))

  if (resolved) return resolved

  const fallbackPath =
    resourcesPath && isPackagedAppRoot(appRoot, resourcesPath)
      ? join(resourcesPath, PACKAGED_AGENT_CORE_DIR)
      : join(appRoot, AGENT_CORE_SOURCE_DIR)

  return candidate(fallbackPath, 'fallback')
}

export function resolveNarraCatAgentCorePath(options: ResolveNarraCatAgentCorePathOptions): string {
  return resolveNarraCatEngine(options).agentCorePath
}

export function hasNarraCatAgentCoreManifest(agentCorePath: string): boolean {
  return existsSync(manifestPath(agentCorePath))
}
