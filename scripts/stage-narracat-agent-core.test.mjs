import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'bun:test'

import {
  FORBIDDEN_RELATIVE_PATHS,
  findFirstStagedRuntimePayloadViolation,
  hasPrunedMcpNodeModuleDirectory,
  pruneStagedMcpRuntimePayload,
  shouldBundleAgentCorePath,
  shouldPruneMcpDistFile,
  shouldPruneMcpNodeModuleDirectory,
  shouldPruneMcpNodeModuleFile,
} from './stage-narracat-agent-core.mjs'

describe('NarraCat Agent Core 打包白名单', () => {
  test('保留运行时真正引用的内部资源', () => {
    const keep = [
      'narracat.manifest.json',
      'package.json',
      'agents/chapter-writer.md',
      'commands/write.md',
      'schemas/ReviewReport.json',
      'templates/premise-template.md',
      'hooks/hooks.json',
      'hooks/scripts/check-chapter-wordcount.sh',
      'skills/novel-web-craft/SKILL.md',
      // ②语料：内测短摘录照留（ADR-0026），运行时由 MCP 检索
      'skills/novel-style-reference/references/corpus/extracts/斩神-extracts.json',
      'skills/novel-style-reference/references/corpus/index.json',
      'docs/contracts/world-guided.md',
      'mcp-server/package.json',
      'mcp-server/dist/index.js',
      'mcp-server/node_modules/better-sqlite3/package.json',
      // 能力包发现根（pack-resolver 相对 dist 回溯至此，B2 第一刀，ADR-0034）
      'packs/official-base/pack.json',
      // 造包中心预览资产（T1 评审后从 packs/authoring 迁至此，防复发误落入 pack-resolver 扫描根；刀3）
      'mcp-server/authoring/typical-scenarios.json',
      'mcp-server/authoring/typical-voices.json',
    ]
    for (const rel of keep) {
      expect({ rel, keep: shouldBundleAgentCorePath(rel) }).toEqual({ rel, keep: true })
    }
  })

  test('挡掉研发痕迹与非运行时文件', () => {
    const drop = [
      'CHANGELOG.md',
      'CLAUDE.md',
      'CONTEXT.md',
      'README.md',
      // 死配置已删（阶段2切片④）：narracat.manifest.json 是自有契约 SSOT，MCP 由 App 层显式配置，不再随包外发
      '.mcp.json',
      // claude-sdk 适配器工件已随 SDK 退役（拆旧刀5）：plugin.json 不再入包
      '.claude-plugin/plugin.json',
      '.claude-plugin',
      '.gitignore',
      '.DS_Store',
      'eval/_runs/run-x/drafts/fixture-01.md',
      'docs/adr/0026-staged-distribution-for-internal-test-and-beta.md',
      'docs/plans/some-plan.md',
      'docs/e2e-verification-guide.md',
      'scripts/corpus-lint.mjs',
      'mcp-server/src/index.ts',
      'skills/novel-web-craft/__tests__/x.ts',
      'schemas/ReviewReport.test.ts',
    ]
    for (const rel of drop) {
      expect({ rel, keep: shouldBundleAgentCorePath(rel) }).toEqual({ rel, keep: false })
    }
  })

  test('放行白名单路径的祖先目录以便递归拷贝', () => {
    // fs.cp 的 filter 需要对祖先目录返回 true，否则后代被整棵剪掉
    for (const rel of ['docs', 'mcp-server', 'skills', 'hooks', 'packs']) {
      expect({ rel, keep: shouldBundleAgentCorePath(rel) }).toEqual({ rel, keep: true })
    }
    // 但 docs 下非 contracts 的子目录仍被挡掉
    expect(shouldBundleAgentCorePath('docs/adr')).toBe(false)
  })

  test('node_modules 内部不透明照搬（不对 test/__tests__ 剔除）', () => {
    expect(shouldBundleAgentCorePath('mcp-server/node_modules/foo/__tests__/a.js')).toBe(true)
    expect(shouldBundleAgentCorePath('mcp-server/node_modules/foo/x.test.js')).toBe(true)
  })

  test('暂存后裁剪 MCP runtime 的开发型文件与目录', () => {
    expect(shouldPruneMcpDistFile('handlers/readers.d.ts')).toBe(true)
    expect(shouldPruneMcpDistFile('handlers/readers.js')).toBe(false)
    // dist 里运行时只需 .js；源映射会把 TS 源路径/内容明文带进分发包，须一并剪掉。
    expect(shouldPruneMcpDistFile('handlers/readers.js.map')).toBe(true)
    expect(shouldPruneMcpDistFile('handlers/readers.d.ts.map')).toBe(true)
    expect(shouldPruneMcpDistFile('index.js.map')).toBe(true)

    const prunedFiles = [
      '@huggingface/transformers/dist/transformers.node.mjs.map',
      '@huggingface/transformers/types/transformers.d.ts',
      '@huggingface/transformers/src/tokenizers.ts',
      'hono/dist/tsconfig.build.tsbuildinfo',
      'zod/README.md',
      'zod/readme.md',
      'zod/CHANGELOG.md',
      'zod/changelog.md',
      'protobufjs/docs/index.md',
    ]
    for (const rel of prunedFiles) {
      expect({ rel, prune: shouldPruneMcpNodeModuleFile(rel) }).toEqual({ rel, prune: true })
    }

    const keptFiles = [
      '@huggingface/transformers/dist/transformers.node.mjs',
      'better-sqlite3/build/Release/better_sqlite3.node',
      'onnxruntime-node/bin/napi-v6/darwin/arm64/onnxruntime_binding.node',
      'sqlite-vec/sqlite-vec.darwin-arm64.node',
      'zod/LICENSE.md',
      // 许可/版权/归属类 .md 不得当作普通 .md 误删（分发包的许可合规义务）。
      'some-dep/COPYING.md',
      'some-dep/NOTICE.md',
      'some-dep/third-party-license.md',
      'some-dep/COPYRIGHT.md',
      'foo/package.json',
      'foo/src/runtime.js',
    ]
    for (const rel of keptFiles) {
      expect({ rel, prune: shouldPruneMcpNodeModuleFile(rel) }).toEqual({ rel, prune: false })
    }

    expect(shouldPruneMcpNodeModuleDirectory('@scope/pkg/docs')).toBe(true)
    expect(shouldPruneMcpNodeModuleDirectory('@scope/pkg/dist')).toBe(false)
    expect(shouldPruneMcpNodeModuleDirectory('yaml/dist/doc')).toBe(false)
    expect(hasPrunedMcpNodeModuleDirectory('@scope/pkg/examples/demo.js')).toBe(true)
    expect(hasPrunedMcpNodeModuleDirectory('yaml/dist/doc/directives.js')).toBe(false)
  })

  test('回归守卫黑名单锚点覆盖主要研发痕迹', () => {
    expect(FORBIDDEN_RELATIVE_PATHS).toContain('eval')
    expect(FORBIDDEN_RELATIVE_PATHS).toContain('CHANGELOG.md')
    expect(FORBIDDEN_RELATIVE_PATHS).toContain('docs/adr')
  })

  test('prune 删尽 MCP runtime 开发型产物、保留运行时文件，verify 复用同一遍历确认无残留', async () => {
    const destination = await mkdtemp(join(tmpdir(), 'narracat-stage-prune-'))
    const mcp = join(destination, 'mcp-server')
    await mkdir(join(mcp, 'dist', 'handlers'), { recursive: true })
    await mkdir(join(mcp, 'node_modules', 'foo', 'test'), { recursive: true })
    await mkdir(join(mcp, 'node_modules', 'onnxruntime-web'), { recursive: true })

    // dist：运行时只留 .js，声明与源映射须剪
    await writeFile(join(mcp, 'dist', 'index.js'), 'export const x = 1\n')
    await writeFile(join(mcp, 'dist', 'index.js.map'), '{}')
    await writeFile(join(mcp, 'dist', 'index.d.ts'), 'export declare const x: number\n')
    await writeFile(join(mcp, 'dist', 'handlers', 'readers.d.ts'), 'export {}\n')
    // node_modules：运行时文件保留，开发型文件/目录与 onnxruntime-web 剪除，许可证保留
    await writeFile(join(mcp, 'node_modules', 'foo', 'index.js'), 'module.exports = {}\n')
    await writeFile(join(mcp, 'node_modules', 'foo', 'README.md'), '# foo\n')
    await writeFile(join(mcp, 'node_modules', 'foo', 'LICENSE.md'), 'MIT\n')
    await writeFile(join(mcp, 'node_modules', 'foo', 'test', 'a.js'), '// test\n')
    await writeFile(join(mcp, 'node_modules', 'onnxruntime-web', 'index.js'), '// web backend\n')

    try {
      await pruneStagedMcpRuntimePayload(destination)

      // 保留
      expect(existsSync(join(mcp, 'dist', 'index.js'))).toBe(true)
      expect(existsSync(join(mcp, 'node_modules', 'foo', 'index.js'))).toBe(true)
      expect(existsSync(join(mcp, 'node_modules', 'foo', 'LICENSE.md'))).toBe(true)
      // 剪除
      expect(existsSync(join(mcp, 'dist', 'index.js.map'))).toBe(false)
      expect(existsSync(join(mcp, 'dist', 'index.d.ts'))).toBe(false)
      expect(existsSync(join(mcp, 'dist', 'handlers', 'readers.d.ts'))).toBe(false)
      expect(existsSync(join(mcp, 'node_modules', 'foo', 'README.md'))).toBe(false)
      expect(existsSync(join(mcp, 'node_modules', 'foo', 'test'))).toBe(false)
      expect(existsSync(join(mcp, 'node_modules', 'onnxruntime-web'))).toBe(false)

      // verify 复用同一遍历，prune 后应零残留
      expect(await findFirstStagedRuntimePayloadViolation(destination)).toBeNull()
    } finally {
      await rm(destination, { recursive: true, force: true })
    }
  })
})
