import { describe, expect, test } from 'bun:test'
import { loadNovelProjectDetail } from '../../electron/main/novel/novel-project'
import { createNovelProjectFixture } from '../../electron/main/novel/test-novel-fixture'
import {
  buildPrimarySectionHref,
  buildWorkbenchTabHref,
  findWorkbenchTab,
  getWorkbenchPrimarySections,
  getWorkbenchTabs,
  resolveWorkbenchSectionId,
} from './workbench-navigation'
import type { NovelProjectDetail } from '@shared/types/novel'

const project: NovelProjectDetail = {
  id: 'p1',
  title: '星辰大海',
  path: '/novels/星辰大海',
  status: 'ready',
  chapterProgress: '2 / 4 章',
  wordCountLabel: '8.4万字',
  tocItems: [],
  treeItems: [
    { id: 'master-outline', kind: 'master-outline', title: '全书大纲', level: 0, exists: true },
    { id: 'volume-1', kind: 'volume', title: '第一卷', level: 0, volumeNumber: 1 },
    { id: 'volume-outline-1', kind: 'volume-outline', title: '第一卷', level: 1, volumeNumber: 1, exists: true },
    { id: 'chapter-1', kind: 'chapter', title: '第 001 章', level: 1, chapterNumber: 1, volumeNumber: 1 },
    { id: 'volume-2', kind: 'volume', title: '第二卷', level: 0, volumeNumber: 2 },
    { id: 'volume-outline-2', kind: 'volume-outline', title: '第二卷', level: 1, volumeNumber: 2, exists: false },
    { id: 'foundation', kind: 'foundation', title: '创作根基', level: 0, exists: true },
    { id: 'bible-premise', kind: 'bible-document', title: '小说前提', level: 1, parentId: 'foundation', exists: true },
    { id: 'world', kind: 'world-list', title: '世界观', level: 1, parentId: 'foundation', exists: true },
    { id: 'characters', kind: 'character-list', title: '小说角色', level: 1, parentId: 'foundation', exists: true },
    { id: 'references', kind: 'reference-list', title: '参考作品', level: 0, exists: true },
    {
      id: 'bible-scenes',
      kind: 'bible-group',
      title: '场景设定',
      level: 1,
      parentId: 'foundation',
      exists: false,
    },
  ],
  checkpoint: null,
}

function completeProject(): NovelProjectDetail {
  return {
    ...project,
    treeItems: project.treeItems.map((item) => ({ ...item, exists: item.exists === false ? true : item.exists })),
  }
}

describe('workbench navigation model', () => {
  test('resolves only known primary section ids', () => {
    expect(resolveWorkbenchSectionId('status')).toBe('status')
    expect(resolveWorkbenchSectionId('settings')).toBe('settings')
    expect(resolveWorkbenchSectionId('reference-works')).toBe('reference-works')
    expect(resolveWorkbenchSectionId(' blueprint ')).toBe('blueprint')
    expect(resolveWorkbenchSectionId('unknown')).toBe('blueprint')
    expect(resolveWorkbenchSectionId(null)).toBe('blueprint')
    expect(resolveWorkbenchSectionId('chat')).toBe('chat')
    expect(resolveWorkbenchSectionId('packs')).toBe('packs')
  })

  test('builds status, reference works, settings, blueprint, packs, and chat primary sections in sidebar order', () => {
    expect(getWorkbenchPrimarySections(project)).toEqual([
      { id: 'status', title: '状态', pending: false, defaultTabId: null },
      { id: 'reference-works', title: '参考作品', pending: false, defaultTabId: 'references' },
      { id: 'settings', title: '设定集', pending: true, defaultTabId: 'bible-premise' },
      { id: 'blueprint', title: '小说大纲', pending: true, defaultTabId: 'master-outline' },
      { id: 'packs', title: '能力包', pending: false, defaultTabId: null },
      { id: 'chat', title: '唠个嗑', pending: false, defaultTabId: null },
    ])
  })

  test('唠个嗑 board has no per-object tabs', () => {
    expect(getWorkbenchTabs(project, 'chat')).toEqual([])
  })

  test('能力包 panel has no per-object tabs', () => {
    expect(getWorkbenchTabs(project, 'packs')).toEqual([])
  })

  test('marks sections pending only when one of its tabs is missing', () => {
    expect(getWorkbenchPrimarySections(completeProject()).map((section) => section.pending)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ])
  })

  test('builds blueprint tabs from master outline and volume outlines only', () => {
    const tabs = getWorkbenchTabs(project, 'blueprint')

    expect(tabs.map((tab) => tab.id)).toEqual(['master-outline', 'volume-outline-1', 'volume-outline-2'])
    expect(tabs.map((tab) => tab.title)).toEqual(['全局大纲', '第一卷', '第二卷'])
    expect(tabs.map((tab) => tab.objectId)).toEqual(['master-outline', 'volume-outline-1', 'volume-outline-2'])
  })

  test('builds reference works as its own section and keeps it out of settings tabs', () => {
    const referenceTabs = getWorkbenchTabs(project, 'reference-works')

    expect(referenceTabs.map((tab) => tab.id)).toEqual(['references'])
    expect(referenceTabs[0]?.emptyDescription).toContain('叙事风格方向由参考指导和大纲叙事声音承载')
    expect(getWorkbenchTabs(project, 'settings').map((tab) => tab.id)).toEqual([
      'bible-premise',
      'world',
      'characters',
      'bible-scenes',
    ])
  })

  test('includes narrator voice as a settings projection when the project tree exposes it', () => {
    const projectWithNarratorVoice: NovelProjectDetail = {
      ...project,
      treeItems: [
        ...project.treeItems,
        {
          id: 'narrator-voice',
          kind: 'narrator-voice',
          title: '叙事声音',
          level: 1,
          parentId: 'foundation',
          exists: true,
        },
      ],
    }

    expect(getWorkbenchTabs(projectWithNarratorVoice, 'settings').map((tab) => tab.id)).toEqual([
      'bible-premise',
      'world',
      'characters',
      'bible-scenes',
      'narrator-voice',
    ])
    expect(getWorkbenchTabs(projectWithNarratorVoice, 'settings').find((tab) => tab.id === 'narrator-voice')).toMatchObject({
      title: '叙事声音',
      exists: true,
    })
  })

  test('maps a real fixture project into blueprint and settings tabs', async () => {
    const fixture = await createNovelProjectFixture({
      name: 'navigation',
      state: 'chaptered',
      dynamicBibleGroups: [{ dirName: 'scenes', files: { 'spaceport.md': '# Spaceport\n' } }],
    })
    const detail = await loadNovelProjectDetail(fixture.root, 2)

    expect(getWorkbenchPrimarySections(detail)).toEqual([
      { id: 'status', title: '状态', pending: false, defaultTabId: null },
      { id: 'reference-works', title: '参考作品', pending: false, defaultTabId: 'references' },
      { id: 'settings', title: '设定集', pending: true, defaultTabId: 'bible-premise' },
      { id: 'blueprint', title: '小说大纲', pending: false, defaultTabId: 'master-outline' },
      { id: 'packs', title: '能力包', pending: false, defaultTabId: null },
      { id: 'chat', title: '唠个嗑', pending: false, defaultTabId: null },
    ])
    expect(getWorkbenchTabs(detail, 'reference-works').map((tab) => tab.id)).toEqual(['references'])
    expect(getWorkbenchTabs(detail, 'blueprint').map((tab) => tab.id)).toEqual([
      'master-outline',
      'volume-outline-1',
    ])
    expect(getWorkbenchTabs(detail, 'settings').map((tab) => tab.id)).toEqual([
      'bible-premise',
      'world',
      'characters',
      'bible-relationships',
      'bible-scenes',
    ])
    expect(getWorkbenchTabs(detail, 'settings').find((tab) => tab.id === 'bible-scenes')).toMatchObject({
      title: '场景设定',
      objectId: 'bible-scenes',
      exists: true,
    })
  })

  test('marks initialized setup templates as pending settings tabs', async () => {
    const fixture = await createNovelProjectFixture({ name: 'navigation-empty', state: 'empty' })
    const detail = await loadNovelProjectDetail(fixture.root)
    const tabs = getWorkbenchTabs(detail, 'settings')

    expect(getWorkbenchTabs(detail, 'reference-works')[0]).toMatchObject({ id: 'references', title: '参考作品' })
    expect(tabs[0]).toMatchObject({ id: 'bible-premise', title: '核心前提' })
    expect(getWorkbenchPrimarySections(detail).find((section) => section.id === 'reference-works')).toMatchObject({
      pending: false,
      defaultTabId: 'references',
    })
    expect(getWorkbenchPrimarySections(detail).find((section) => section.id === 'settings')).toMatchObject({
      pending: true,
      defaultTabId: 'bible-premise',
    })
    expect(tabs.find((tab) => tab.id === 'bible-relationships')).toMatchObject({ exists: false })
    expect(tabs.find((tab) => tab.id === 'characters')).toMatchObject({ exists: false })
    expect(tabs.find((tab) => tab.id === 'world')).toMatchObject({ exists: false })
  })

  test('falls back to the first tab for unknown tab ids', () => {
    const tabs = getWorkbenchTabs(project, 'settings')

    expect(findWorkbenchTab(tabs, 'world')?.id).toBe('world')
    expect(findWorkbenchTab(tabs, 'missing-tab')?.id).toBe('bible-premise')
    expect(findWorkbenchTab([], 'missing-tab')).toBeNull()
  })

  test('builds tab and primary section hrefs with section and tab params', () => {
    const settingsSection = getWorkbenchPrimarySections(project).find((section) => section.id === 'settings')

    expect(buildWorkbenchTabHref({ projectPath: project.path, sectionId: 'settings', tabId: 'bible-scenes' })).toBe(
      '/workbench?project=%2Fnovels%2F%E6%98%9F%E8%BE%B0%E5%A4%A7%E6%B5%B7&section=settings&tab=bible-scenes',
    )
    expect(buildWorkbenchTabHref({ projectPath: project.path, sectionId: 'reference-works', tabId: 'references' })).toBe(
      '/workbench?project=%2Fnovels%2F%E6%98%9F%E8%BE%B0%E5%A4%A7%E6%B5%B7&section=reference-works&tab=references',
    )
    expect(settingsSection ? buildPrimarySectionHref({ projectPath: project.path, section: settingsSection }) : null).toBe(
      '/workbench?project=%2Fnovels%2F%E6%98%9F%E8%BE%B0%E5%A4%A7%E6%B5%B7&section=settings&tab=bible-premise',
    )
  })
})
