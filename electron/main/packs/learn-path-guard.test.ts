import { describe, expect, test, beforeEach, afterEach } from 'bun:test'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLearnPathGuard } from './learn-path-guard'

// Windows 无管理员/开发者模式时 symlinkSync 抛 EPERM——symlink 逃逸测试需要真实软链，
// 无权限环境下跳过（mac/linux 与有权限的 Windows CI 全跑）。
const canCreateSymlink = (() => {
  if (process.platform !== 'win32') return true
  try {
    const dir = mkdtempSync(join(tmpdir(), 'symlink-probe-'))
    writeFileSync(join(dir, 'target.txt'), 'x')
    symlinkSync(join(dir, 'target.txt'), join(dir, 'link'))
    rmSync(dir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
})()

let workspaceDir: string
let outsideDir: string
let cleanupRoots: string[]

const toolUseOptions = { signal: new AbortController().signal, toolUseID: 'test-tool-use-1' }

beforeEach(() => {
  const wsRoot = mkdtempSync(join(tmpdir(), 'learn-path-guard-ws-'))
  const outRoot = mkdtempSync(join(tmpdir(), 'learn-path-guard-out-'))
  cleanupRoots = [wsRoot, outRoot]
  workspaceDir = wsRoot
  outsideDir = outRoot
  mkdirSync(join(workspaceDir, 'source'), { recursive: true })
  mkdirSync(join(workspaceDir, 'output'), { recursive: true })
  writeFileSync(join(workspaceDir, 'source', 'ch-0001.md'), '# 第1章\n\n正文。\n', 'utf8')
  writeFileSync(join(outsideDir, 'secret.md'), '外部机密。\n', 'utf8')
})

afterEach(() => {
  for (const root of cleanupRoots) rmSync(root, { recursive: true, force: true })
})

describe('createLearnPathGuard（PR#477 外审 P1-1：学习会话路径沙盒）', () => {
  test('工作区内相对路径 Read → allow', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Read', { file_path: 'source/ch-0001.md' }, toolUseOptions)
    expect(result.behavior).toBe('allow')
  })

  test('工作区内绝对路径 Write → allow', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Write', { file_path: join(workspaceDir, 'output', 'cards.json'), content: '{}' }, toolUseOptions)
    expect(result.behavior).toBe('allow')
  })

  test('工作区外绝对路径 Read → deny', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Read', { file_path: join(outsideDir, 'secret.md') }, toolUseOptions)
    expect(result.behavior).toBe('deny')
  })

  test('../ 相对路径逃逸 → deny', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Read', { file_path: '../../../../../../etc/passwd' }, toolUseOptions)
    expect(result.behavior).toBe('deny')
  })

  test.skipIf(!canCreateSymlink)('绝对路径字面在界内但 realpath 经真实 symlink 逃逸出界 → deny', async () => {
    const linkPath = join(workspaceDir, 'output', 'evil-link')
    symlinkSync(outsideDir, linkPath)
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Read', { file_path: join(linkPath, 'secret.md') }, toolUseOptions)
    expect(result.behavior).toBe('deny')
  })

  test('不存在的目标文件但父目录在界内（Write 新文件）→ allow', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Write', { file_path: join(workspaceDir, 'output', 'cards.json'), content: '{}' }, toolUseOptions)
    expect(result.behavior).toBe('allow')
  })

  test('Glob 缺省 path（视为 cwd）→ allow', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Glob', { pattern: '*.md' }, toolUseOptions)
    expect(result.behavior).toBe('allow')
  })

  test('Glob 有 path 且在工作区内 → allow', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Glob', { pattern: '*.md', path: join(workspaceDir, 'source') }, toolUseOptions)
    expect(result.behavior).toBe('allow')
  })

  test('Glob 越界 path → deny', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Glob', { pattern: '*.md', path: outsideDir }, toolUseOptions)
    expect(result.behavior).toBe('deny')
  })

  test('未知工具（收紧工具面之外，防御纵深）→ deny', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Bash', { command: 'ls' }, toolUseOptions)
    expect(result.behavior).toBe('deny')
  })

  test('工作区根本身经 symlink（如 macOS /tmp）也能正确判定边界内路径', async () => {
    // realpathSync(workspaceDir) 应已把 workspaceDir 归一化成真实边界；用归一化后的路径重新构造
    // 一个 Read 请求，确认不会因为 workspaceDir 传入值与 realpath 值不一致而误判出界。
    const realWorkspace = realpathSync(workspaceDir)
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Read', { file_path: join(realWorkspace, 'source', 'ch-0001.md') }, toolUseOptions)
    expect(result.behavior).toBe('allow')
  })

  test('Read 缺失 file_path 参数 → deny', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Read', {}, toolUseOptions)
    expect(result.behavior).toBe('deny')
  })

  // Task 7: pi 原生字段名 path 兼容性（阶段2切片④）
  test('pi 内置工具原生字段名 path → allow（工作区内相对路径）', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Read', { path: 'source/ch-0001.md' }, toolUseOptions)
    expect(result.behavior).toBe('allow')
  })

  test('pi 原生字段名 path → allow（工作区内绝对路径）', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Read', { path: join(workspaceDir, 'source', 'ch-0001.md') }, toolUseOptions)
    expect(result.behavior).toBe('allow')
  })

  test('pi 原生字段名 path → deny（工作区外）', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Write', { path: join(outsideDir, 'evil.md'), content: 'bad' }, toolUseOptions)
    expect(result.behavior).toBe('deny')
  })

  test('两字段都缺 Read/Write → deny（fail-closed）', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Read', {}, toolUseOptions)
    expect(result.behavior).toBe('deny')
  })

  test('SDK 字段名 file_path 仍支持（回归）', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Read', { file_path: join(workspaceDir, 'source', 'ch-0001.md') }, toolUseOptions)
    expect(result.behavior).toBe('allow')
  })

  // Issue #482: deny 措辞 label 化（向导会话复用本 guard，文案进模型上下文须随语境）
  test('缺省 label：越界 deny 文案保持「学习工作区」（向后兼容）', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Read', { file_path: join(outsideDir, 'secret.md') }, toolUseOptions)
    if (result.behavior !== 'deny') throw new Error('应为 deny')
    expect(result.message).toContain('学习工作区')
  })

  test('缺省 label：未知工具 deny 文案保持「学习会话」（向后兼容）', async () => {
    const guard = createLearnPathGuard(workspaceDir)
    const result = await guard('Bash', { command: 'ls' }, toolUseOptions)
    if (result.behavior !== 'deny') throw new Error('应为 deny')
    expect(result.message).toContain('学习会话')
  })

  test('label=向导：越界 deny 文案用「向导工作区」', async () => {
    const guard = createLearnPathGuard(workspaceDir, { label: '向导' })
    const result = await guard('Read', { file_path: join(outsideDir, 'secret.md') }, toolUseOptions)
    if (result.behavior !== 'deny') throw new Error('应为 deny')
    expect(result.message).toContain('向导工作区')
    expect(result.message).not.toContain('学习')
  })

  test('label=向导：未知工具 deny 文案用「向导会话」', async () => {
    const guard = createLearnPathGuard(workspaceDir, { label: '向导' })
    const result = await guard('Bash', { command: 'ls' }, toolUseOptions)
    if (result.behavior !== 'deny') throw new Error('应为 deny')
    expect(result.message).toContain('向导会话')
    expect(result.message).not.toContain('学习')
  })
})
