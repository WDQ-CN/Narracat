import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'

const design = readFileSync('docs/design.md', 'utf8')
const checkDesign = readFileSync('scripts/check-design-system.mjs', 'utf8')
const brandEntrypoint = readFileSync('src/components/brand/index.ts', 'utf8')
const brandReadme = readFileSync('src/components/brand/README.md', 'utf8')

// docs/agents/workflow.md 是内部 OPS 流程文档，开源准备（2026-08-04）时已从公开仓
// .gitignore 排除（见仓库根 .gitignore「private assets」段）——全新 checkout 里不存在。
// 该文件在场时（内部/dogfood 环境）才读取并跑下面「OPS guidance」用例，缺席环境跳过。
const WORKFLOW_DOC_PATH = 'docs/agents/workflow.md'
const WORKFLOW_DOC_AVAILABLE = existsSync(WORKFLOW_DOC_PATH)
const workflow = WORKFLOW_DOC_AVAILABLE ? readFileSync(WORKFLOW_DOC_PATH, 'utf8') : ''

describe('brand governance', () => {
  test('documents a stable component entrypoint for future pages', () => {
    expect(brandReadme).toContain('BrandMark')
    expect(brandReadme).toContain('BrandLockup')
    expect(brandReadme).toContain('BrandIllustration')
    expect(brandReadme).toContain('BrandStoryBanner')
    expect(brandReadme).toContain('不要直接 import')
    expect(brandReadme).toContain('docs/design.md')
    expect(brandEntrypoint).toContain("export { BrandMark }")
    expect(brandEntrypoint).toContain("export { BrandLockup }")
    expect(brandEntrypoint).toContain("export { BrandIllustration }")
    expect(brandEntrypoint).toContain("export { BrandStoryBanner }")
  })

  test('keeps durable logo rules aligned with the accepted implementation', () => {
    expect(design).toContain('Logo 通过 `BrandMark` 以原始图片直接展示')
    expect(design).toContain('不额外包裹装饰容器')
    expect(design).toContain('浅色和暗色模式使用同一张 `narracat-mark.webp`')
  })

  test('design guard protects brand tokens, primitives, registry, and raw asset boundaries', () => {
    expect(checkDesign).toContain('src/components/brand/BrandMark.tsx')
    expect(checkDesign).toContain('src/components/brand/BrandIllustration.tsx')
    expect(checkDesign).toContain('src/components/brand/BrandStoryBanner.tsx')
    expect(checkDesign).toContain('src/components/brand/brand-illustrations.ts')
    expect(checkDesign).toContain('src/components/brand/README.md')
    expect(checkDesign).toContain('assets/brand/')
    expect(checkDesign).toContain('assets/illustrations/narracat/')
  })

  test.skipIf(!WORKFLOW_DOC_AVAILABLE)('OPS guidance points brand asset work at the durable rules', () => {
    expect(workflow).toContain('品牌资产')
    expect(workflow).toContain('docs/design.md')
    expect(workflow).toContain('src/components/brand/README.md')
  })
})
