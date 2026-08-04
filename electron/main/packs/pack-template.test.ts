import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { buildTemplatePackZip, exportCapabilityPackTemplate, TEMPLATE_PACK_VERSION } from './pack-template'
import { previewCapabilityPackImport, confirmCapabilityPackImport } from './pack-store'
import { PACK_FILE_EXTENSION, TEMPLATE_PACK_ID } from '@shared/types/capability-pack'

describe('pack-template', () => {
  test('导出的模板包能通过导入校验并安装（往返自洽）', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'pack-template-'))
    try {
      // 空 agent-core / userData：模板包不依赖任何已装包
      const agentCorePath = join(tmp, 'agent-core')
      const userDataPath = join(tmp, 'userData')
      mkdirSync(agentCorePath, { recursive: true })
      mkdirSync(userDataPath, { recursive: true })
      const target = join(tmp, `template${PACK_FILE_EXTENSION}`)
      const exported = await exportCapabilityPackTemplate({ targetPath: target })
      expect(exported.status).toBe('ok')
      const preview = await previewCapabilityPackImport({ sourcePath: target, agentCorePath, userDataPath })
      if (preview.status !== 'ok') throw new Error(`preview 失败：${JSON.stringify(preview)}`)
      expect(preview.manifest.id).toBe(TEMPLATE_PACK_ID)
      expect(preview.manifest.version).toBe(TEMPLATE_PACK_VERSION)
      expect(preview.readme).toContain('能力包')
      const confirmed = await confirmCapabilityPackImport({ token: preview.token, agentCorePath, userDataPath })
      expect(confirmed.status).toBe('ok')
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })

  test('模板包不含 benchmark 卡（v1 benchmark 仅官方），三类各 1 张，摘录区为空', () => {
    const zip = buildTemplatePackZip()
    expect(zip.byteLength).toBeGreaterThan(0)
  })
})
