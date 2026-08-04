import { join } from 'node:path'
import { scanCharacterSettings } from './appeared-characters.ts'
import { narracatMemoryDbPath } from './novel-layout.ts'
import type { OpenMemoryDb } from './memory-db.ts'

/**
 * 正文分诊用实体名收集：角色名 + 别名（bible/characters 档案）+ 短伏笔描述
 * （foreshadowing_registry，memory.db 只读）。任何一路缺失/失败都静默跳过——
 * 实体名只是分诊信号，不是保存的前置条件。
 */

const MIN_ENTITY_LENGTH = 2
/** 伏笔描述超过该长度视为句子而非关键词，不参与 includes 匹配。 */
const MAX_FORESHADOWING_KEYWORD_LENGTH = 12

export async function collectManuscriptEntityNames({
  projectPath,
  openMemoryDb,
}: {
  projectPath: string
  openMemoryDb?: OpenMemoryDb
}): Promise<string[]> {
  const names = new Set<string>()

  try {
    for (const entry of await scanCharacterSettings(projectPath)) {
      const name = entry.name.trim()
      if (name.length >= MIN_ENTITY_LENGTH) names.add(name)
      for (const alias of entry.aliases ?? []) {
        const trimmed = alias.trim()
        if (trimmed.length >= MIN_ENTITY_LENGTH) names.add(trimmed)
      }
    }
  } catch {
    // 无角色档案时跳过
  }

  if (openMemoryDb) {
    try {
      const reader = openMemoryDb(join(projectPath, narracatMemoryDbPath()))
      try {
        const rows = reader.all<{ description: string }>('SELECT description FROM foreshadowing_registry')
        for (const row of rows) {
          const description = (row.description ?? '').trim()
          if (description.length >= MIN_ENTITY_LENGTH && description.length <= MAX_FORESHADOWING_KEYWORD_LENGTH) {
            names.add(description)
          }
        }
      } finally {
        reader.close()
      }
    } catch {
      // 无记忆库 / 缺表时跳过
    }
  }

  return [...names]
}
