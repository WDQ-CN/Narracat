export interface ManuscriptDraftInput {
  projectPath: string
  chapter: number
}

export interface SaveManuscriptDraftInput extends ManuscriptDraftInput {
  baseVisibleText: string
  draftText: string
}

export interface ManuscriptDraftSummary {
  chapter: number
  updatedAt: string
}

export type ManuscriptDraftState =
  | { status: 'none' }
  | { status: 'recoverable'; chapter: number; draftText: string; diskText: string; updatedAt: string }
  | {
      status: 'conflict'
      chapter: number
      draftText: string
      diskText: string
      updatedAt: string
    }
  | { status: 'corrupt'; chapter: number; errorId: string }
