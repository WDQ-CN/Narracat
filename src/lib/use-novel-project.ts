import { useEffect } from 'react'
import {
  deleteNovelProject,
  getNarraCatDiagnostics,
  getNovelProject,
  getNovelWorkbenchArtifacts,
  listNovelProjects,
  updateNovelProjectMetadata,
} from '@/lib/ipc'
import {
  EMPTY_LOAD_STATE,
  beginLoad,
  completeLoad,
  createLoadIssue,
  failLoad,
  runWithFiniteRetry,
} from './load-state'
import { useNovelStore } from './novel-store'
import { resolveCurrentStageChapterId } from './workbench-chapter-state'
import { findWorkbenchTab, getWorkbenchTabs } from './workbench-navigation'
import type { WorkbenchPrimarySectionId } from './workbench-navigation'
import type {
  NovelChapterArtifacts,
  NovelProjectDetail,
  NovelWorkbenchArtifacts,
  NovelWorkbenchTreeItem,
  DeleteNovelProjectInput,
  DeleteNovelProjectResult,
  UpdateNovelProjectMetadataInput,
} from '@shared/types/novel'
import type { NarraCatArtifactKind } from '@shared/types/narracat'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function workbenchArtifactKindToChapterArtifactKind(kind: string): NarraCatArtifactKind | null {
  if (kind === 'chapter-outline') return 'outline'
  if (kind === 'manuscript' || kind === 'context-pack' || kind === 'review' || kind === 'deep-review') return kind
  return null
}

export function createChapterArtifactsFromWorkbenchArtifacts({
  selectedTreeItem,
  workbenchArtifacts,
}: {
  selectedTreeItem: NovelWorkbenchTreeItem | undefined
  workbenchArtifacts: NovelWorkbenchArtifacts
}): NovelChapterArtifacts | null {
  if (
    selectedTreeItem?.kind !== 'chapter' ||
    !selectedTreeItem.chapterNumber ||
    workbenchArtifacts.objectKind !== 'chapter'
  ) {
    return null
  }

  return {
    projectPath: workbenchArtifacts.projectPath,
    chapterNumber: selectedTreeItem.chapterNumber,
    volumeNumber: selectedTreeItem.volumeNumber,
    artifacts: workbenchArtifacts.artifacts.flatMap((artifact) => {
      const kind = workbenchArtifactKindToChapterArtifactKind(artifact.kind)
      if (!kind) return []

      return [
        {
          kind,
          title: artifact.title,
          path: artifact.path ?? '',
          exists: artifact.exists,
          content: artifact.content,
          data: artifact.data,
          error: artifact.error,
        },
      ]
    }),
  }
}

export function resolveWorkbenchObjectId({
  detail,
  selectedChapter,
  selectedObjectId,
  selectedSectionId,
  selectedTabId,
}: {
  detail: NovelProjectDetail
  selectedChapter?: number
  selectedObjectId?: string
  selectedSectionId?: WorkbenchPrimarySectionId
  selectedTabId?: string | null
}): string | null {
  if (selectedSectionId) {
    const activeTab = findWorkbenchTab(
      getWorkbenchTabs(detail, selectedSectionId),
      selectedTabId ?? selectedObjectId ?? null,
    )
    if (activeTab) return activeTab.objectId
  }

  const byExplicitObject = selectedObjectId
    ? detail.treeItems.find((item) => item.id === selectedObjectId)?.id
    : undefined
  if (byExplicitObject) return byExplicitObject

  const chapterFromQuery = selectedChapter
    ? detail.treeItems.find((item) => item.id === `chapter-${selectedChapter}`)?.id
    : undefined
  if (chapterFromQuery) return chapterFromQuery

  const defaultObjectId = resolveDefaultWorkbenchObjectId(detail)
  if (defaultObjectId) return defaultObjectId

  return detail.treeItems[0]?.id ?? null
}

export function resolveDefaultWorkbenchObjectId(detail: NovelProjectDetail): string | null {
  const currentStageChapterId = resolveCurrentStageChapterId(detail.tocItems)
  const currentStageTreeItem = currentStageChapterId
    ? detail.treeItems.find((item) => item.id === currentStageChapterId)
    : undefined
  if (currentStageTreeItem) return currentStageTreeItem.id

  if (detail.status === 'needs-setup') {
    const referenceWorksObjectId = getWorkbenchTabs(detail, 'reference-works')[0]?.objectId
    if (referenceWorksObjectId) return referenceWorksObjectId
  }

  return getWorkbenchTabs(detail, 'settings')[0]?.objectId ?? detail.treeItems[0]?.id ?? null
}

export async function reloadLibraryProjects(): Promise<void> {
  const store = useNovelStore.getState()
  const previousLoad = store.libraryLoad
  store.setNovelLoading(true)
  store.setNovelError(null)
  store.setLibraryLoad(beginLoad(previousLoad))

  try {
    const [diagnostics, projects] = await runWithFiniteRetry(() =>
      Promise.all([getNarraCatDiagnostics(), listNovelProjects()]),
    )

    useNovelStore.getState().setDiagnostics(diagnostics)
    useNovelStore.getState().setProjects(projects)
    useNovelStore.getState().setLibraryLoad(completeLoad())
  } catch (error) {
    useNovelStore.getState().setLibraryLoad(failLoad(previousLoad, createLoadIssue('library', error)))
  } finally {
    useNovelStore.getState().setNovelLoading(false)
  }
}

export async function saveLibraryProjectMetadata(
  input: UpdateNovelProjectMetadataInput,
): Promise<NovelProjectDetail> {
  useNovelStore.getState().setNovelError(null)

  try {
    const updatedProject = await updateNovelProjectMetadata(input)
    await reloadLibraryProjects()

    if (useNovelStore.getState().activeProject?.path === updatedProject.path) {
      useNovelStore.getState().setActiveProject(updatedProject)
    }

    return updatedProject
  } catch (error) {
    const message = errorMessage(error)
    useNovelStore.getState().setNovelError(message)
    throw error
  }
}

export async function deleteLibraryProject(
  input: DeleteNovelProjectInput,
): Promise<DeleteNovelProjectResult> {
  useNovelStore.getState().setNovelError(null)

  try {
    const result = await deleteNovelProject(input)
    clearWorkbenchArtifactsCacheForProject(result.projectPath)
    await reloadLibraryProjects()

    if (useNovelStore.getState().activeProject?.path === result.projectPath) {
      useNovelStore.getState().setActiveProject(null)
      useNovelStore.getState().setActiveWorkbenchArtifacts(null)
      useNovelStore.getState().setActiveArtifacts(null)
    }

    return result
  } catch (error) {
    const message = errorMessage(error)
    useNovelStore.getState().setNovelError(message)
    throw error
  }
}

// 工作台内容产物缓存（ADR-0022）：切 tab/菜单秒回 + stale-while-revalidate。
// 键 = 项目路径::对象 id::卷号——含路径防串项目，含卷号因其影响 getNovelWorkbenchArtifacts 读取结果。
const workbenchArtifactsCache = new Map<string, NovelWorkbenchArtifacts>()
let lastWorkbenchProjectPath: string | null = null

function workbenchArtifactsCacheKey(projectPath: string, objectId: string, volumeNumber?: number): string {
  return `${projectPath}::${objectId}::${volumeNumber ?? ''}`
}

export function clearWorkbenchArtifactsCacheForProject(projectPath: string): void {
  const prefix = `${projectPath}::`
  for (const key of workbenchArtifactsCache.keys()) {
    if (key.startsWith(prefix)) workbenchArtifactsCache.delete(key)
  }
}

// 只读窥探缓存条目（测试/调试用）。
export function peekWorkbenchArtifactsCache(
  projectPath: string,
  objectId: string,
  volumeNumber?: number,
): NovelWorkbenchArtifacts | undefined {
  return workbenchArtifactsCache.get(workbenchArtifactsCacheKey(projectPath, objectId, volumeNumber))
}

// 仅后台 revalidate 用：内容相同则跳过 set，避免把正在阅读的页面无谓重渲染（打断滚动/选区）。
// JSON 序列化对一屏文本一次性比较，开销远小于一次重 parse，且后台执行不阻塞首屏。
function workbenchArtifactsEqual(a: NovelWorkbenchArtifacts, b: NovelWorkbenchArtifacts): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// loadWorkbenchProject 的并发序号：run 结束附近的增量刷新与终态刷新会并发，
// 旧刷新在 await 后凭此放弃写 store，避免覆盖最新刷新结果成空态。
let activeWorkbenchLoadToken = 0

export async function loadWorkbenchProject(
  projectPath: string,
  selectedChapter?: number,
  selectedObjectId?: string,
  selectedSectionId?: WorkbenchPrimarySectionId,
  selectedTabId?: string | null,
  options?: { smooth?: boolean },
): Promise<void> {
  // smooth 刷新（run 进行中增量刷新）：不显示 loading、不预清空已显示产物，
  // fetch 完成后直接替换，避免「闪空→重现」。仅切项目 / 切对象才走清空路径。
  const smooth = options?.smooth ?? false
  const store = useNovelStore.getState()
  const previousLoad =
    smooth && store.activeProject?.path === projectPath
      ? store.workbenchLoad
      : EMPTY_LOAD_STATE
  const loadToken = ++activeWorkbenchLoadToken
  const isStale = () => loadToken !== activeWorkbenchLoadToken
  if (!smooth) {
    useNovelStore.getState().setNovelLoading(true)
    useNovelStore.getState().setActiveWorkbenchArtifacts(null)
    useNovelStore.getState().setActiveArtifacts(null)
  }
  store.setNovelError(null)
  store.setWorkbenchLoad(beginLoad(previousLoad))

  try {
    const detail = await runWithFiniteRetry(() => getNovelProject(projectPath, selectedChapter))
    if (isStale()) return
    useNovelStore.getState().setActiveProject(detail)

    const objectId = resolveWorkbenchObjectId({
      detail,
      selectedChapter,
      selectedObjectId,
      selectedSectionId,
      selectedTabId,
    })
    const selectedTreeItem = objectId ? detail.treeItems.find((item) => item.id === objectId) : undefined

    if (!objectId) {
      if (!smooth && !isStale()) {
        useNovelStore.getState().setActiveWorkbenchArtifacts(null)
        useNovelStore.getState().setActiveArtifacts(null)
      }
      if (!isStale()) useNovelStore.getState().setWorkbenchLoad(completeLoad())
      return
    }

    const workbenchArtifacts = await runWithFiniteRetry(() =>
      getNovelWorkbenchArtifacts(detail.path, objectId, selectedTreeItem?.volumeNumber),
    )
    if (isStale()) return
    // run 结束 / 手动刷新（含 smooth 增量）也写回缓存，确保 Agent 改过文件后切回该对象不显示陈旧内容。
    workbenchArtifactsCache.set(
      workbenchArtifactsCacheKey(detail.path, objectId, selectedTreeItem?.volumeNumber),
      workbenchArtifacts,
    )
    useNovelStore.getState().setActiveWorkbenchArtifacts(workbenchArtifacts)
    useNovelStore
      .getState()
      .setActiveArtifacts(createChapterArtifactsFromWorkbenchArtifacts({ selectedTreeItem, workbenchArtifacts }))
    useNovelStore.getState().setWorkbenchLoad(completeLoad())
  } catch (error) {
    if (isStale()) return
    // smooth 刷新失败时保留现有内容，不清空已显示产物。
    if (!smooth) {
      useNovelStore.getState().setActiveProject(null)
      useNovelStore.getState().setActiveWorkbenchArtifacts(null)
      useNovelStore.getState().setActiveArtifacts(null)
    }
    useNovelStore
      .getState()
      .setWorkbenchLoad(failLoad(previousLoad, createLoadIssue('workbench', error)))
  } finally {
    if (!smooth) useNovelStore.getState().setNovelLoading(false)
  }
}

export function prepareWorkbenchProjectLoad(projectPath: string): void {
  const state = useNovelStore.getState()
  const shouldClearProject = state.activeProject?.path !== projectPath

  state.setNovelLoading(true)
  state.setNovelError(null)
  state.setWorkbenchLoad(beginLoad(EMPTY_LOAD_STATE))
  if (shouldClearProject) state.setActiveProject(null)
  state.setActiveWorkbenchArtifacts(null)
  state.setActiveArtifacts(null)
}

export function resolveReusableWorkbenchProjectDetail(projectPath: string): NovelProjectDetail | null {
  const activeProject = useNovelStore.getState().activeProject
  return activeProject?.path === projectPath ? activeProject : null
}

export function useLibraryProjects() {
  useEffect(() => {
    void reloadLibraryProjects()
  }, [])
}

export function useWorkbenchProject(
  projectPath: string | null,
  selectedChapter?: number,
  selectedObjectId?: string,
  selectedSectionId?: WorkbenchPrimarySectionId,
  selectedTabId?: string | null,
) {
  useEffect(() => {
    if (!projectPath) {
      useNovelStore.getState().setActiveProject(null)
      useNovelStore.getState().setActiveWorkbenchArtifacts(null)
      useNovelStore.getState().setActiveArtifacts(null)
      useNovelStore.getState().setNovelError(null)
      useNovelStore.getState().setWorkbenchLoad(EMPTY_LOAD_STATE)
      useNovelStore.getState().setNovelLoading(false)
      return
    }

    let cancelled = false
    const activeProjectPath = projectPath

    // 切到别的项目：清掉上一项目的内容缓存，防泄漏、防串项目（ADR-0022）。
    if (lastWorkbenchProjectPath && lastWorkbenchProjectPath !== activeProjectPath) {
      clearWorkbenchArtifactsCacheForProject(lastWorkbenchProjectPath)
    }
    lastWorkbenchProjectPath = activeProjectPath

    // 读对象内容产物 → 写回 store，并同步写缓存。
    // background=true 为缓存命中后的后台 revalidate：内容与缓存相同则跳过 set（不打断阅读）；
    // 读取失败保留缓存内容、不报错。background=false 失败上抛交外层统一处理。
    async function applyWorkbenchArtifacts(
      detail: NovelProjectDetail,
      objectId: string,
      selectedTreeItem: NovelWorkbenchTreeItem | undefined,
      background: boolean,
    ): Promise<void> {
      // 后台 revalidate 纳入 loadWorkbenchProject 的并发序号（review P2）：读盘期间若有权威刷新
      //（run 结束 / 手动刷新 = loadWorkbenchProject，会 ++activeWorkbenchLoadToken）写入更新，
      // 本次旧结果整个丢弃——绝不回写陈旧内容覆盖 cache/store。
      const startToken = activeWorkbenchLoadToken
      try {
        const workbenchArtifacts = await runWithFiniteRetry(() =>
          getNovelWorkbenchArtifacts(
            detail.path,
            objectId,
            selectedTreeItem?.volumeNumber,
          ),
        )
        if (cancelled) return
        if (background && activeWorkbenchLoadToken !== startToken) return

        const cacheKey = workbenchArtifactsCacheKey(detail.path, objectId, selectedTreeItem?.volumeNumber)
        const previous = workbenchArtifactsCache.get(cacheKey)
        workbenchArtifactsCache.set(cacheKey, workbenchArtifacts)
        if (background && previous && workbenchArtifactsEqual(previous, workbenchArtifacts)) return

        useNovelStore.getState().setActiveWorkbenchArtifacts(workbenchArtifacts)
        useNovelStore
          .getState()
          .setActiveArtifacts(createChapterArtifactsFromWorkbenchArtifacts({ selectedTreeItem, workbenchArtifacts }))
      } catch (error) {
        if (background) {
          if (cancelled || activeWorkbenchLoadToken !== startToken) return
          const currentLoad = useNovelStore.getState().workbenchLoad
          useNovelStore
            .getState()
            .setWorkbenchLoad(failLoad(currentLoad, createLoadIssue('workbench', error)))
          return
        }
        throw error
      }
    }

    async function load() {
      // 缓存命中快速路径（ADR-0022）：同项目可复用 detail + 内容已缓存
      // → 不闪 loading、不清空，直接秒显缓存内容，再后台静默 revalidate。
      const reusableDetail = resolveReusableWorkbenchProjectDetail(activeProjectPath)
      if (reusableDetail) {
        const objectId = resolveWorkbenchObjectId({
          detail: reusableDetail,
          selectedChapter,
          selectedObjectId,
          selectedSectionId,
          selectedTabId,
        })
        const selectedTreeItem = objectId
          ? reusableDetail.treeItems.find((item) => item.id === objectId)
          : undefined
        const cached = objectId
          ? workbenchArtifactsCache.get(
              workbenchArtifactsCacheKey(activeProjectPath, objectId, selectedTreeItem?.volumeNumber),
            )
          : undefined

        if (objectId && cached) {
          useNovelStore.getState().setNovelError(null)
          useNovelStore.getState().setActiveProject(reusableDetail)
          useNovelStore.getState().setActiveWorkbenchArtifacts(cached)
          useNovelStore.getState().setActiveArtifacts(
            createChapterArtifactsFromWorkbenchArtifacts({ selectedTreeItem, workbenchArtifacts: cached }),
          )
          useNovelStore.getState().setWorkbenchLoad(completeLoad())
          void applyWorkbenchArtifacts(reusableDetail, objectId, selectedTreeItem, true)
          return
        }
      }

      // 未命中：现有 loading + 清空 + 读盘路径（首次进入某对象，物理上要等读盘）。
      prepareWorkbenchProjectLoad(activeProjectPath)

      try {
        const detail =
          reusableDetail ??
          (await runWithFiniteRetry(() => getNovelProject(activeProjectPath, selectedChapter)))
        if (cancelled) return

        useNovelStore.getState().setActiveProject(detail)

        const objectId = resolveWorkbenchObjectId({
          detail,
          selectedChapter,
          selectedObjectId,
          selectedSectionId,
          selectedTabId,
        })
        const selectedTreeItem = objectId ? detail.treeItems.find((item) => item.id === objectId) : undefined

        if (!objectId) {
          useNovelStore.getState().setActiveWorkbenchArtifacts(null)
          useNovelStore.getState().setActiveArtifacts(null)
          useNovelStore.getState().setWorkbenchLoad(completeLoad())
          return
        }

        await applyWorkbenchArtifacts(detail, objectId, selectedTreeItem, false)
        if (!cancelled) useNovelStore.getState().setWorkbenchLoad(completeLoad())
      } catch (error) {
        if (!cancelled) {
          useNovelStore.getState().setActiveProject(null)
          useNovelStore.getState().setActiveWorkbenchArtifacts(null)
          useNovelStore.getState().setActiveArtifacts(null)
          const currentLoad = useNovelStore.getState().workbenchLoad
          useNovelStore
            .getState()
            .setWorkbenchLoad(failLoad(currentLoad, createLoadIssue('workbench', error)))
        }
      } finally {
        if (!cancelled) useNovelStore.getState().setNovelLoading(false)
      }
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [projectPath, selectedChapter, selectedObjectId, selectedSectionId, selectedTabId])
}
