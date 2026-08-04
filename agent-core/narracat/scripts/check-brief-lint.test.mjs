import { spawnSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from 'node:test'

/**
 * 回归测试（PR #506 人审 P1）：check-brief-lint.sh 硬门曾依赖系统 python3 解析
 * stdin JSON 与计算 marker 文件年龄——违反 ADR-0009（硬门不得依赖用户系统 PATH，
 * 静默失效会让「禁系统词泄漏进写手视野」这道闸直接失效）。
 *
 * 修复：FILE_PATH 提取改纯 grep/sed；marker 新鲜度判定改 find -mmin -5。
 * 本测试用一个会 exit 127 的假 python3 shim 前置进 PATH，证明脚本执行全程零依赖。
 */

const agentCoreRoot = join(import.meta.dirname, '..')
const hookPath = join(agentCoreRoot, 'hooks', 'scripts', 'check-brief-lint.sh')
const hookSource = readFileSync(hookPath, 'utf-8')

describe('check-brief-lint.sh 静态断言', () => {
  test('脚本文本不含 python3', () => {
    assert.ok(!hookSource.includes('python3'), '硬门脚本不得依赖 python3（ADR-0009）')
  })
})

describe('check-brief-lint.sh 功能四态（PATH 内前置零依赖假 python3 shim）', () => {
  let root
  let fakeBinDir
  let stagingDir
  let briefPath
  let markerPath
  let restrictedPath

  test.beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'narracat-brief-lint-'))
    fakeBinDir = join(root, 'fake-bin')
    mkdirSync(fakeBinDir, { recursive: true })
    const shimPath = join(fakeBinDir, 'python3')
    writeFileSync(shimPath, '#!/bin/sh\nexit 127\n', 'utf-8')
    chmodSync(shimPath, 0o755)

    stagingDir = join(root, '.narracat', 'staging')
    mkdirSync(stagingDir, { recursive: true })
    briefPath = join(stagingDir, 'ch-004.brief.md')
    markerPath = join(stagingDir, '.brief-lint-warned-ch-004')
    restrictedPath = join(root, 'manuscript', 'vol-01', 'ch-004.md')
    mkdirSync(join(root, 'manuscript', 'vol-01'), { recursive: true })
  })

  test.afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function runHook(filePath) {
    const input = JSON.stringify({ tool_input: { file_path: filePath } })
    // 假 python3 shim 前置进 PATH：若脚本仍调用 python3 会立即以 127 失败，暴露依赖。
    const env = { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}` }
    return spawnSync('bash', [hookPath], { input, encoding: 'utf-8', env })
  }

  test('含系统词 → exit 2、stderr 非空、marker 生成', () => {
    writeFileSync(briefPath, '本章要处理 heartbeat_moment，主角情绪转折。', 'utf-8')

    const result = runHook(briefPath)

    assert.equal(result.status, 2)
    assert.ok(result.stderr.length > 0)
    assert.ok(result.stderr.includes('heartbeat_moment'))
    assert.ok(existsSync(markerPath), 'marker 应生成')
  })

  test('紧接第二次同内容 → exit 0 放行、marker 被清', () => {
    writeFileSync(briefPath, '本章要处理 heartbeat_moment，主角情绪转折。', 'utf-8')
    const first = runHook(briefPath)
    assert.equal(first.status, 2)

    const second = runHook(briefPath)

    assert.equal(second.status, 0)
    assert.ok(second.stdout.includes('已放行'))
    assert.ok(!existsSync(markerPath), 'marker 应被清除')
  })

  test('干净中文内容 → exit 0、无 marker', () => {
    writeFileSync(briefPath, '这一章沈砚独自回到旧宅，翻看了母亲留下的信件。', 'utf-8')

    const result = runHook(briefPath)

    assert.equal(result.status, 0)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
    assert.ok(!existsSync(markerPath), '不应生成 marker')
  })

  test('非 brief 路径 → exit 0 跳过', () => {
    writeFileSync(restrictedPath, '本章要处理 heartbeat_moment。', 'utf-8')

    const result = runHook(restrictedPath)

    assert.equal(result.status, 0)
    assert.equal(result.stdout, '')
    assert.equal(result.stderr, '')
  })
})
