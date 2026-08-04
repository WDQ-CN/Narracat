import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { MasterOutlineCardsView } from './MasterOutlineCardsView'
import type { NovelArtifact } from '@shared/types/novel'

const artifact: NovelArtifact = {
  id: 'master-outline',
  title: '全局大纲',
  exists: true,
  content: '',
  data: {
    central_dramatic_question: '他能证明江湖不需要执剑之人吗',
    protagonist_core_desire: '除尽天下恶',
    protagonist_core_lack: '想要不需要剑的世界',
    antagonistic_force: '人心与制度',
    stakes_progression: '卷一失自由，卷二失信任',
    storylines: [
      { id: 'SL-MAIN', name: '证明之路', type: 'main', priority: 1, entry_chapter: 1 },
      // 老数据兜底：缺 id 的条目不出第一档编辑入口。
      { name: '无主键旧故事线', type: 'sub', priority: 2, entry_chapter: 5 },
    ],
    foreshadowing_registry: [
      { id: 'F-MAJ-01', type: 'major', description: '铁匠铺背后另有隐情', planted_chapter: 8, target_reveal: '180' },
      { description: '无主键旧伏笔', type: 'minor', planted_chapter: 12, target_reveal: '90' },
    ],
    volumes: [{ volume_no: 1, title: '第一卷', arc_list: [] }],
  },
} as unknown as NovelArtifact

describe('MasterOutlineCardsView', () => {
  test('渲染五个引擎字段与故事线/伏笔/卷章结构', () => {
    const html = renderToStaticMarkup(<MasterOutlineCardsView artifact={artifact} onEvaluateImpact={() => {}} />)
    expect(html).toContain('中心戏剧问题')
    expect(html).toContain('除尽天下恶')
    expect(html).toContain('证明之路')
    expect(html).toContain('铁匠铺背后另有隐情')
    expect(html).toContain('卷章结构')
    // 机器主键不裸露（ADR-0016）
    expect(html).not.toContain('SL-MAIN')
    expect(html).not.toContain('F-MAJ-01')
  })

  test('四个映射字段有第二档编辑入口', () => {
    const html = renderToStaticMarkup(<MasterOutlineCardsView artifact={artifact} onEvaluateImpact={() => {}} />)
    expect(html.match(/data-master-outline-edit="/g)?.length).toBe(4)
    expect(html).not.toContain('data-master-outline-edit="stakes_progression"')
  })

  test('stakes 有独立第二档编辑入口（onEvaluateOutlineImpact 驱动，不需要 onEvaluateImpact）', () => {
    const html = renderToStaticMarkup(
      <MasterOutlineCardsView artifact={artifact} onEvaluateOutlineImpact={() => {}} />,
    )
    expect(html).toContain('data-master-outline-edit="stakes_progression"')
    // stakes 与四映射字段分流：这里没给 onEvaluateImpact，四映射字段应无编辑入口。
    expect(html.match(/data-master-outline-edit="/g)?.length).toBe(1)
  })

  test('onEvaluateOutlineImpact 缺席时 stakes 无编辑入口；onEvaluateImpact 缺席时四映射字段无编辑入口', () => {
    const html = renderToStaticMarkup(<MasterOutlineCardsView artifact={artifact} />)
    expect(html).not.toContain('data-master-outline-edit=')
  })

  test('projectPath 存在时故事线名/伏笔描述出现第一档编辑入口，数量=有 id 的故事线数+伏笔数', () => {
    const html = renderToStaticMarkup(<MasterOutlineCardsView artifact={artifact} projectPath="/novels/p" />)
    // 2 个故事线中只有 1 个有 id，2 个伏笔中只有 1 个有 id → 共 2 个第一档入口。
    expect(html.match(/data-master-outline-tier1-edit="/g)?.length).toBe(2)
    expect(html).toContain('证明之路')
    expect(html).toContain('无主键旧故事线')
    expect(html).toContain('铁匠铺背后另有隐情')
    expect(html).toContain('无主键旧伏笔')
    // 第一档渲染路径同样不裸露机器主键（ADR-0016）——回归锁：编辑入口 DOM 属性/文案不得泄漏 id。
    expect(html).not.toContain('SL-MAIN')
    expect(html).not.toContain('F-MAJ-01')
  })

  test('projectPath 缺失时第一档编辑入口消失（但不影响 stakes 第二档入口）', () => {
    const html = renderToStaticMarkup(
      <MasterOutlineCardsView artifact={artifact} onEvaluateImpact={() => {}} onEvaluateOutlineImpact={() => {}} />,
    )
    expect(html).not.toContain('data-master-outline-tier1-edit=')
    expect(html).toContain('data-master-outline-edit="stakes_progression"')
  })

  test('data 缺失时空态', () => {
    const html = renderToStaticMarkup(
      <MasterOutlineCardsView artifact={{ ...artifact, data: undefined } as NovelArtifact} />,
    )
    expect(html).toContain('大纲数据契约缺失')
  })
})

describe('MasterOutlineCardsView · 第一档保存链路（源码断言，静态渲染无法驱动交互）', () => {
  test('保存传 expectedOldValue 原值，成功调 onChanged，失败展示 message', () => {
    const source = readFileSync(fileURLToPath(new URL('./MasterOutlineCardsView.tsx', import.meta.url)), 'utf-8')

    expect(source).toContain('submitMasterOutlineFieldEdit')
    expect(source).toContain('expectedOldValue:')
    expect(source).toContain('onChanged?.()')
    expect(source).toContain('toast.success')
    expect(source).toContain("result.message ?? '保存失败'")
    expect(source).toContain('storyline_name')
    expect(source).toContain('foreshadowing_description')
  })
})
