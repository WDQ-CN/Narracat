import { create } from 'zustand'
import { EMPTY_LOAD_STATE, type LoadState } from '@/lib/load-state'
import type { NarraCatAgentCoreDiagnostics } from '@shared/types/narracat'
import type {
  NovelChapterArtifacts,
  NovelProjectDetail,
  NovelProjectSummary,
  NovelWorkbenchArtifacts,
} from '@shared/types/novel'

interface NovelStore {
  diagnostics: NarraCatAgentCoreDiagnostics | null
  projects: NovelProjectSummary[]
  activeProject: NovelProjectDetail | null
  activeArtifacts: NovelChapterArtifacts | null
  activeWorkbenchArtifacts: NovelWorkbenchArtifacts | null
  libraryLoad: LoadState
  workbenchLoad: LoadState
  loading: boolean
  creating: boolean
  savingSetup: boolean
  error: string | null
  setDiagnostics: (diagnostics: NarraCatAgentCoreDiagnostics) => void
  setProjects: (projects: NovelProjectSummary[]) => void
  setActiveProject: (project: NovelProjectDetail | null) => void
  setActiveArtifacts: (artifacts: NovelChapterArtifacts | null) => void
  setActiveWorkbenchArtifacts: (artifacts: NovelWorkbenchArtifacts | null) => void
  setLibraryLoad: (load: LoadState) => void
  setWorkbenchLoad: (load: LoadState) => void
  setNovelLoading: (loading: boolean) => void
  setNovelCreating: (creating: boolean) => void
  setNovelSetupSaving: (savingSetup: boolean) => void
  setNovelError: (error: string | null) => void
  resetNovelState: () => void
}

export const useNovelStore = create<NovelStore>((set) => ({
  diagnostics: null,
  projects: [],
  activeProject: null,
  activeArtifacts: null,
  activeWorkbenchArtifacts: null,
  libraryLoad: EMPTY_LOAD_STATE,
  workbenchLoad: EMPTY_LOAD_STATE,
  loading: false,
  creating: false,
  savingSetup: false,
  error: null,
  setDiagnostics: (diagnostics) => set({ diagnostics }),
  setProjects: (projects) => set({ projects }),
  setActiveProject: (activeProject) => set({ activeProject }),
  setActiveArtifacts: (activeArtifacts) => set({ activeArtifacts }),
  setActiveWorkbenchArtifacts: (activeWorkbenchArtifacts) => set({ activeWorkbenchArtifacts }),
  setLibraryLoad: (libraryLoad) => set({ libraryLoad }),
  setWorkbenchLoad: (workbenchLoad) => set({ workbenchLoad }),
  setNovelLoading: (loading) => set({ loading }),
  setNovelCreating: (creating) => set({ creating }),
  setNovelSetupSaving: (savingSetup) => set({ savingSetup }),
  setNovelError: (error) => set({ error }),
  resetNovelState: () =>
    set({
      diagnostics: null,
      projects: [],
      activeProject: null,
      activeArtifacts: null,
      activeWorkbenchArtifacts: null,
      libraryLoad: EMPTY_LOAD_STATE,
      workbenchLoad: EMPTY_LOAD_STATE,
      loading: false,
      creating: false,
      savingSetup: false,
      error: null,
    }),
}))
