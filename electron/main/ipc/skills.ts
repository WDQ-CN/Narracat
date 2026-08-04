import { BrowserWindow, dialog, ipcMain } from 'electron'
import {
  listSkillMounts,
  removeSkillMount,
  resetAgentSkillMounts,
  setSkillMount,
} from '../engine/skill-mount-store.ts'
import {
  importUserSkill,
  listUserSkills,
  previewUserSkillImport,
  readUserSkillBody,
  uninstallUserSkill,
  userSkillStorePath,
} from '../engine/user-skill-store.ts'
import { InvalidSkillFolderError, SkillNameConflictError } from '../engine/validate-skill-folder.ts'
import type { CommitUserSkillResult, PreviewUserSkillResult } from '@shared/types/skill-mount'
import { readNarraCatAgentCoreDiagnostics } from '../engine/agent-core-contract.ts'
import { invalidateAgentSessions } from './agent.ts'
import { currentAgentCorePath } from './app.ts'
import { readInputRecord, readRequiredString, skillMountsPath, userDataPath } from './inputs.ts'

/**
 * 官方 Skill 名集合（diagnostics.availableSkills），用户 Skill 撞名拒绝的官方侧来源（#294）。
 * 读诊断失败时降级为空集：官方撞名校验失活不阻断导入，store 内「该 Agent 已挂用户名」校验仍生效。
 */
async function readOfficialSkillNames(): Promise<string[]> {
  try {
    return (await readNarraCatAgentCoreDiagnostics(currentAgentCorePath())).availableSkills
  } catch {
    return []
  }
}

export function registerSkillsIpcHandlers(): void {
  ipcMain.handle('skill-mounts:list', async () => {
    return listSkillMounts(skillMountsPath())
  })

  ipcMain.handle('skill-mounts:set', async (_event, input: unknown) => {
    const result = await setSkillMount(skillMountsPath(), input)
    await invalidateAgentSessions('skill-mount-changed')
    return result
  })

  ipcMain.handle('skill-mounts:remove', async (_event, input: unknown) => {
    const result = await removeSkillMount(skillMountsPath(), input)
    await invalidateAgentSessions('skill-mount-changed')
    return result
  })

  ipcMain.handle('skill-mounts:reset-agent', async (_event, input: unknown) => {
    const result = await resetAgentSkillMounts(skillMountsPath(), input)
    await invalidateAgentSessions('skill-mount-changed')
    return result
  })

  ipcMain.handle('user-skills:list', async () => {
    return listUserSkills(userSkillStorePath(userDataPath()))
  })

  // 用户 Skill 导入预检（#294）：开目录选择器 + 校验 + scripts 探测 + 撞名判定，**不复制快照**。
  // 撞名来源：官方 skill 名（diagnostics.availableSkills）+ 该 Agent 已挂用户 skill 名（store 内查）。
  // renderer 据此分流：conflict 直接拒绝；hasScripts 弹一次确认；否则直接 commit。把撞名挡在复制前。
  ipcMain.handle('user-skills:preview-import', async (event, input: unknown): Promise<PreviewUserSkillResult> => {
    const value = readInputRecord(input, '挂载用户 Skill 参数非法。')
    const agentId = readRequiredString(value, 'agentId', '缺少 Agent id。')

    const parent = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      title: '选择本地 Skill 文件夹',
      buttonLabel: '挂载',
    }
    const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    const folderPath = result.filePaths[0]
    if (result.canceled || !folderPath) return { status: 'canceled' }

    try {
      const officialSkillNames = await readOfficialSkillNames()
      const preview = await previewUserSkillImport({
        folderPath,
        agentId,
        userDataPath: userDataPath(),
        officialSkillNames,
      })
      // 文案与 commit 侧统一走 SkillNameConflictError，避免双写漂移。
      if (preview.conflict) return { status: 'conflict', message: new SkillNameConflictError().message }
      return { status: 'ready', folderPath, name: preview.name, hasScripts: preview.hasScripts }
    } catch (error) {
      if (error instanceof InvalidSkillFolderError) return { status: 'invalid', message: error.message }
      throw error
    }
  })

  // 用户 Skill 导入提交（#294）：接预检透传的 folderPath，复制快照 + 写记录。撞名/校验在信任边界再查一遍
  // （纵深防御，即便绕过预检直调也挡得住）。renderer 在 scripts 确认后 / 无 scripts 直接调用本通道。
  ipcMain.handle('user-skills:commit-import', async (_event, input: unknown): Promise<CommitUserSkillResult> => {
    const value = readInputRecord(input, '挂载用户 Skill 参数非法。')
    const agentId = readRequiredString(value, 'agentId', '缺少 Agent id。')
    const folderPath = readRequiredString(value, 'folderPath', '缺少 Skill 文件夹路径。')

    try {
      const officialSkillNames = await readOfficialSkillNames()
      const skills = await importUserSkill({ folderPath, agentId, userDataPath: userDataPath(), officialSkillNames })
      await invalidateAgentSessions('user-skill-changed')
      return { status: 'ok', skills }
    } catch (error) {
      if (error instanceof SkillNameConflictError) return { status: 'conflict', message: error.message }
      if (error instanceof InvalidSkillFolderError) return { status: 'invalid', message: error.message }
      throw error
    }
  })

  ipcMain.handle('user-skills:uninstall', async (_event, input: unknown) => {
    const value = readInputRecord(input, '卸载用户 Skill 参数非法。')
    const id = readRequiredString(value, 'id', '缺少用户 Skill id。')
    const result = await uninstallUserSkill({ id, userDataPath: userDataPath() })
    await invalidateAgentSessions('user-skill-changed')
    return result
  })

  // 读用户 Skill 快照正文（详情弹窗展示，#293）：仅用户自定义可看正文，官方走黑盒不经此路。
  // 越界守卫与读失败降级在 store 内处理，返回空串由渲染端友好提示。
  ipcMain.handle('user-skills:read-body', async (_event, input: unknown): Promise<string> => {
    const value = readInputRecord(input, '读取用户 Skill 正文参数非法。')
    const id = readRequiredString(value, 'id', '缺少用户 Skill id。')
    return readUserSkillBody({ id, userDataPath: userDataPath() })
  })
}
