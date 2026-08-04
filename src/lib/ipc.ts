// 渲染端 IPC client（typed wrapper over window.electron）
// 让组件不直接 touch window.electron，方便未来加错误处理 / mock
import type {
  AgentEventEnvelopeV1,
  AgentEventsAfterResultV1,
  AgentHistorySegmentSummaryV1,
  AgentRunRequest,
  AgentRunStarted,
  AgentStartNewConversationInput,
  AgentThreadSnapshotV1,
  AppConfig,
  AppConfigPayload,
  CharacterChatProfiles,
  CharacterChatSendRequest,
  CharacterChatStreamEvent,
  CharacterChatTranscript,
  CharacterChatUserMode,
  CharacterContactList,
  ConnectionTestResult,
  CreatedNovelProject,
  CreateNovelProjectBackupDialogResult,
  CreateNovelProjectInput,
  DeleteNovelProjectInput,
  DeleteNovelProjectResult,
  ElectronApi,
  NarraCatAgentCoreDiagnostics,
  NovelChapterArtifacts,
  NovelProjectDetail,
  NovelProjectSummary,
  RememberNovelProjectPathInput,
  NovelStatusSnapshot,
  NovelWorkbenchArtifacts,
  PasteReferenceSourceInput,
  PremiseEditResult,
  AuthoredStateEditInput,
  ChapterOutlineFieldEditInput,
  CharacterIdentityEditInput,
  MasterOutlineFieldEditInput,
  ManuscriptEditInput,
  ManuscriptDraftInput,
  ManuscriptDraftState,
  ManuscriptDraftSummary,
  ManuscriptSaveResult,
  ManuscriptRevisionContent,
  ManuscriptRevisionInput,
  ManuscriptRevisionList,
  ReadManuscriptRevisionInput,
  RestoreManuscriptRevisionInput,
  RestoreNovelProjectBackupDialogResult,
  PendingMemorySyncEntry,
  PremiseFieldEditInput,
  ProviderId,
  ProviderModelListResult,
  ReferenceWorksSummary,
  RemoveReferenceSourceInput,
  ResolvePlannedStateInput,
  UpdateChapterStateChangesInput,
  UpdateNovelProjectMetadataInput,
  ResultNotification,
  ResultNotificationList,
  EmbeddingHealthProbeResult,
  ReleaseGateVerdict,
  SaveManuscriptDraftInput,
  StoredWorkLocation,
} from '@shared/types/ipc'
import type { AgentQuestionAnswer } from '@/types/agent'
import type { AgentSkillMount, CommitUserSkillResult, PreviewUserSkillResult, UserSkill } from '@shared/types/skill-mount'
import type { CharacterStateSnapshot } from '@shared/types/character-state'
import type {
  PlannedStateCounts,
  PlannedStateReadResult,
  ReadPlannedStateCountsInput,
  ReadPlannedStateInput,
} from '@shared/types/planned-state'

export function ping(): Promise<string> {
  return window.electron.ping()
}

export function checkReleaseGuard(): Promise<ReleaseGateVerdict> {
  return window.electron.checkReleaseGuard()
}

export function getConfig(): Promise<AppConfigPayload> {
  return window.electron.getConfig()
}

export function saveConfig(config: AppConfig): Promise<AppConfigPayload> {
  return window.electron.saveConfig(config)
}

export function setPrimaryModel(key: string): Promise<AppConfigPayload> {
  return window.electron.setPrimaryModel(key)
}

export function setApiKey(provider: ProviderId, apiKey: string): Promise<{ hasApiKey: boolean }> {
  return window.electron.setApiKey(provider, apiKey)
}

export function deleteApiKey(provider: ProviderId): Promise<{ hasApiKey: boolean }> {
  return window.electron.deleteApiKey(provider)
}

export function hasApiKey(provider: ProviderId): Promise<{ hasApiKey: boolean }> {
  return window.electron.hasApiKey(provider)
}

export function testConnection(provider: ProviderId): Promise<ConnectionTestResult> {
  return window.electron.testConnection(provider)
}

export function listProviderModels(provider: ProviderId): Promise<ProviderModelListResult> {
  return window.electron.listProviderModels(provider)
}

export function getNarraCatDiagnostics(): Promise<NarraCatAgentCoreDiagnostics> {
  return window.electron.getNarraCatDiagnostics()
}

export function listSkillMounts(): Promise<AgentSkillMount[]> {
  return window.electron.listSkillMounts()
}

export function setSkillMount(mount: AgentSkillMount): Promise<AgentSkillMount[]> {
  return window.electron.setSkillMount(mount)
}

export function removeSkillMount(input: { agentId: string; skillId: string }): Promise<AgentSkillMount[]> {
  return window.electron.removeSkillMount(input)
}

export function resetAgentSkillMounts(input: { agentId: string }): Promise<AgentSkillMount[]> {
  return window.electron.resetAgentSkillMounts(input)
}

export function listUserSkills(): Promise<UserSkill[]> {
  return window.electron.listUserSkills()
}

/**
 * 导入预检（#294）：开目录选择器 + 校验 + scripts 探测 + 撞名判定，不复制快照。
 * 返回 canceled / invalid / conflict / ready 判别联合；ready 携 folderPath + hasScripts 供后续 commit。
 */
export function previewUserSkillImport(input: { agentId: string }): Promise<PreviewUserSkillResult> {
  return window.electron.previewUserSkillImport(input)
}

/**
 * 提交导入（#294）：接预检 ready 的 folderPath，复制快照 + 写记录。
 * 撞名/校验在主进程信任边界再查一遍；返回 invalid / conflict / ok 判别联合。
 */
export function commitUserSkillImport(input: { agentId: string; folderPath: string }): Promise<CommitUserSkillResult> {
  return window.electron.commitUserSkillImport(input)
}

export function uninstallUserSkill(input: { id: string }): Promise<UserSkill[]> {
  return window.electron.uninstallUserSkill(input)
}

/** 读用户 Skill 快照 SKILL.md 正文（详情弹窗展示）；读失败主进程降级返回空串，不抛 */
export function readUserSkillBody(input: { id: string }): Promise<string> {
  return window.electron.readUserSkillBody(input)
}

export function runEmbeddingHealthProbe(): Promise<EmbeddingHealthProbeResult> {
  return window.electron.runEmbeddingHealthProbe()
}

export function listResultNotifications(): Promise<ResultNotificationList> {
  return window.electron.listResultNotifications()
}

export function upsertResultNotification(notification: ResultNotification): Promise<ResultNotificationList> {
  return window.electron.upsertResultNotification(notification)
}

export function markResultNotificationRead(id: string): Promise<ResultNotificationList> {
  return window.electron.markResultNotificationRead(id)
}

export function markAllResultNotificationsRead(): Promise<ResultNotificationList> {
  return window.electron.markAllResultNotificationsRead()
}

export function readWorkLocation(): Promise<StoredWorkLocation> {
  return window.electron.readWorkLocation()
}

export function writeWorkLocation(location: StoredWorkLocation): Promise<void> {
  return window.electron.writeWorkLocation(location)
}

export function listNovelProjects(): Promise<NovelProjectSummary[]> {
  return window.electron.listNovelProjects()
}

export function createNovelProjectBackup(
  projectPath: string,
): Promise<CreateNovelProjectBackupDialogResult> {
  return window.electron.createNovelProjectBackup(projectPath)
}

export function restoreNovelProjectBackup(): Promise<RestoreNovelProjectBackupDialogResult> {
  return window.electron.restoreNovelProjectBackup()
}

export function rememberNovelProjectPath(input: RememberNovelProjectPathInput): Promise<{ updated: boolean }> {
  return window.electron.rememberNovelProjectPath(input)
}

export function createNovelProject(input: CreateNovelProjectInput): Promise<CreatedNovelProject> {
  return window.electron.createNovelProject(input)
}

export function updateNovelProjectMetadata(input: UpdateNovelProjectMetadataInput): Promise<NovelProjectDetail> {
  return window.electron.updateNovelProjectMetadata(input)
}

export function deleteNovelProject(input: DeleteNovelProjectInput): Promise<DeleteNovelProjectResult> {
  return window.electron.deleteNovelProject(input)
}

export function getNovelProject(projectPath: string, selectedChapter?: number): Promise<NovelProjectDetail> {
  return window.electron.getNovelProject(projectPath, selectedChapter)
}

export function readNovelStatus(projectPath: string): Promise<NovelStatusSnapshot | null> {
  return window.electron.readNovelStatus(projectPath)
}

export function refreshNovelStatus(projectPath: string): Promise<NovelStatusSnapshot> {
  return window.electron.refreshNovelStatus(projectPath)
}

export function listAppearedCharacters(projectPath: string): Promise<CharacterContactList> {
  return window.electron.listAppearedCharacters(projectPath)
}

export function readCharacterState(input: {
  projectPath: string
  characterUid: string
  characterName: string
}): Promise<CharacterStateSnapshot> {
  return window.electron.readCharacterState(input)
}

export function readPlannedState(input: ReadPlannedStateInput): Promise<PlannedStateReadResult> {
  return window.electron.readPlannedState(input)
}

export function readPlannedStateCounts(input: ReadPlannedStateCountsInput): Promise<PlannedStateCounts> {
  return window.electron.readPlannedStateCounts(input)
}

export function enrichCharacterStatuses(input: {
  projectPath: string
  characterUids: string[]
  knowledgeBoundaryChapter: number | null
}): Promise<Record<string, string>> {
  return window.electron.enrichCharacterStatuses(input)
}

export function getNovelChapterArtifacts(
  projectPath: string,
  chapterNumber: number,
  volumeNumber?: number,
): Promise<NovelChapterArtifacts> {
  return window.electron.getNovelChapterArtifacts(projectPath, chapterNumber, volumeNumber)
}

export function getNovelWorkbenchArtifacts(
  projectPath: string,
  objectId: string,
  volumeNumber?: number,
): Promise<NovelWorkbenchArtifacts> {
  return window.electron.getNovelWorkbenchArtifacts(projectPath, objectId, volumeNumber)
}

export function submitPremiseFieldEdit(input: PremiseFieldEditInput): Promise<PremiseEditResult> {
  return window.electron.submitPremiseFieldEdit(input)
}

export function submitChapterOutlineFieldEdit(input: ChapterOutlineFieldEditInput): Promise<{ ok: boolean; message?: string }> {
  return window.electron.submitChapterOutlineFieldEdit(input)
}

export function submitMasterOutlineFieldEdit(input: MasterOutlineFieldEditInput): Promise<{ ok: boolean; message?: string }> {
  return window.electron.submitMasterOutlineFieldEdit(input)
}

export function submitAuthoredState(input: AuthoredStateEditInput): Promise<{ ok: boolean; message?: string }> {
  return window.electron.submitAuthoredState(input)
}

export function resolvePlannedState(input: ResolvePlannedStateInput): Promise<{ ok: boolean; message?: string }> {
  return window.electron.resolvePlannedState(input)
}

export function updateChapterStateChanges(input: UpdateChapterStateChangesInput): Promise<{ ok: boolean; message?: string }> {
  return window.electron.updateChapterStateChanges(input)
}

export function submitCharacterIdentity(input: CharacterIdentityEditInput): Promise<{ ok: boolean; message?: string }> {
  return window.electron.submitCharacterIdentity(input)
}

export function saveChapterManuscript(input: ManuscriptEditInput): Promise<ManuscriptSaveResult> {
  return window.electron.saveChapterManuscript(input)
}

export function listManuscriptRevisions(input: ManuscriptRevisionInput): Promise<ManuscriptRevisionList> {
  return window.electron.listManuscriptRevisions(input)
}

export function readManuscriptRevision(input: ReadManuscriptRevisionInput): Promise<ManuscriptRevisionContent> {
  return window.electron.readManuscriptRevision(input)
}

export function restoreManuscriptRevision(input: RestoreManuscriptRevisionInput): Promise<ManuscriptSaveResult> {
  return window.electron.restoreManuscriptRevision(input)
}

export function submitStyleAnchor(input: Parameters<ElectronApi['submitStyleAnchor']>[0]) {
  return window.electron.submitStyleAnchor(input)
}

export function listStyleAnchors(input: Parameters<ElectronApi['listStyleAnchors']>[0]) {
  return window.electron.listStyleAnchors(input)
}

export function getManuscriptDraft(input: ManuscriptDraftInput): Promise<ManuscriptDraftState> {
  return window.electron.getManuscriptDraft(input)
}

export function saveManuscriptDraft(input: SaveManuscriptDraftInput): Promise<{ ok: true }> {
  return window.electron.saveManuscriptDraft(input)
}

export function discardManuscriptDraft(input: ManuscriptDraftInput): Promise<{ ok: true }> {
  return window.electron.discardManuscriptDraft(input)
}

export function listManuscriptDrafts(projectPath: string): Promise<ManuscriptDraftSummary[]> {
  return window.electron.listManuscriptDrafts(projectPath)
}

export function getPendingMemorySync(projectPath: string): Promise<Record<string, PendingMemorySyncEntry>> {
  return window.electron.getPendingMemorySync(projectPath)
}

export function clearPendingMemorySync(projectPath: string, chapter: number): Promise<{ ok: boolean }> {
  return window.electron.clearPendingMemorySync({ projectPath, chapter })
}

export function pasteReferenceSource(input: PasteReferenceSourceInput): Promise<ReferenceWorksSummary> {
  return window.electron.pasteReferenceSource(input)
}

export function importReferenceSourceFiles(projectPath: string): Promise<ReferenceWorksSummary> {
  return window.electron.importReferenceSourceFiles(projectPath)
}

export function removeReferenceSource(input: RemoveReferenceSourceInput): Promise<ReferenceWorksSummary> {
  return window.electron.removeReferenceSource(input)
}

export function clearReferenceGuidance(projectPath: string): Promise<ReferenceWorksSummary> {
  return window.electron.clearReferenceGuidance(projectPath)
}

export function resetReferenceWorks(projectPath: string): Promise<ReferenceWorksSummary> {
  return window.electron.resetReferenceWorks(projectPath)
}

export function selectDirectory(): Promise<string | null> {
  return window.electron.selectDirectory()
}

export function startAgentRun(request: AgentRunRequest): Promise<AgentRunStarted> {
  return window.electron.startAgentRun({ ...request, requestId: request.requestId ?? crypto.randomUUID() })
}

export function cancelAgentRun(runId: string): Promise<{ cancelled: boolean }> {
  return window.electron.cancelAgentRun({ runId, requestId: crypto.randomUUID() })
}

export function answerAgentQuestion(answer: AgentQuestionAnswer): Promise<{ accepted: boolean }> {
  return window.electron.answerAgentQuestion({
    requestId: crypto.randomUUID(),
    questionRequestId: answer.requestId,
    answers: answer.answers,
  }).then((result) => {
    if (!result.accepted) {
      throw new Error('问题已过期或当前运行已结束。')
    }

    return result
  })
}

export function forgetAgentSession(threadId: string): Promise<void> {
  return window.electron.forgetAgentSession({ threadId, requestId: crypto.randomUUID() })
}

export function getAgentThreadSnapshot(
  threadId: string,
  segmentId?: string,
): Promise<AgentThreadSnapshotV1> {
  return window.electron.getAgentThreadSnapshot({ threadId, segmentId })
}

export function getAgentEventsAfter(
  threadId: string,
  segmentId: string,
  afterSeq: number,
): Promise<AgentEventsAfterResultV1> {
  return window.electron.getAgentEventsAfter({ threadId, segmentId, afterSeq })
}

export function listAgentHistorySegments(threadId: string): Promise<AgentHistorySegmentSummaryV1[]> {
  return window.electron.listAgentHistorySegments(threadId)
}

export function startNewAgentConversation(
  input: AgentStartNewConversationInput,
): Promise<AgentThreadSnapshotV1> {
  return window.electron.startNewAgentConversation(input)
}

export function onAgentEvent(callback: (event: AgentEventEnvelopeV1) => void): () => void {
  return window.electron.onAgentEvent(callback)
}

export function sendCharacterChatMessage(request: CharacterChatSendRequest): Promise<{ runId: string }> {
  return window.electron.sendCharacterChatMessage(request)
}

export function cancelCharacterChat(runId: string): Promise<{ cancelled: boolean }> {
  return window.electron.cancelCharacterChat(runId)
}

export function onCharacterChatEvent(callback: (event: CharacterChatStreamEvent) => void): () => void {
  return window.electron.onCharacterChatEvent(callback)
}

export function readCharacterChatTranscript(input: {
  projectPath: string
  characterUid: string
  userMode: CharacterChatUserMode
}): Promise<CharacterChatTranscript> {
  return window.electron.readCharacterChatTranscript(input)
}

export function saveCharacterChatTranscript(input: {
  projectPath: string
  characterUid: string
  userMode: CharacterChatUserMode
  messages: CharacterChatTranscript['messages']
}): Promise<CharacterChatTranscript> {
  return window.electron.saveCharacterChatTranscript(input)
}

export function readCharacterChatProfiles(input: {
  projectPath: string
  characterUid: string
}): Promise<CharacterChatProfiles> {
  return window.electron.readCharacterChatProfiles(input)
}

export function saveCharacterChatProfile(input: {
  scope: 'author' | 'impression'
  content: string
  projectPath: string
  characterUid: string
}): Promise<void> {
  return window.electron.saveCharacterChatProfile(input)
}

export function flushCharacterChatProfile(input: {
  projectPath: string
  characterUid: string
  characterName: string
}): Promise<void> {
  return window.electron.flushCharacterChatProfile(input)
}

export function onOpenResultNotification(callback: (notification: ResultNotification) => void): () => void {
  return window.electron.onOpenResultNotification(callback)
}

export function onResultNotificationsChanged(callback: (event: ResultNotificationList) => void): () => void {
  return window.electron.onResultNotificationsChanged(callback)
}
