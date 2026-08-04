import { randomUUID } from 'node:crypto'
import { open, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'

export interface AtomicWriteOperations {
  open: typeof open
  rename: typeof rename
  rm: typeof rm
  stat: typeof stat
}

const defaultOperations: AtomicWriteOperations = { open, rename, rm, stat }
const toleratedDirectorySyncCodes = new Set(['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM'])

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined
}

/**
 * 同目录临时文件 → fsync 临时文件 → rename 替换 → fsync 父目录。
 *
 * rename 是目标文件唯一的可见切换点，因此崩溃或写入失败时，读者只会看到完整旧文件
 * 或完整新文件。父目录 fsync 在不支持目录句柄同步的平台上按能力降级。
 */
export async function atomicWriteFile(
  targetPath: string,
  content: string | Uint8Array,
  operations: AtomicWriteOperations = defaultOperations,
): Promise<void> {
  const parentPath = dirname(targetPath)
  const tempPath = join(parentPath, `.${basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`)
  let tempExists = false
  let fileHandle: Awaited<ReturnType<typeof open>> | null = null

  try {
    fileHandle = await operations.open(tempPath, 'wx')
    tempExists = true

    try {
      const targetInfo = await operations.stat(targetPath)
      await fileHandle.chmod(targetInfo.mode)
    } catch {
      // 新文件没有可继承的 mode；沿用进程 umask。
    }

    await fileHandle.writeFile(content, typeof content === 'string' ? { encoding: 'utf-8' } : undefined)
    await fileHandle.sync()
    await fileHandle.close()
    fileHandle = null

    await operations.rename(tempPath, targetPath)
    tempExists = false

    let directoryHandle: Awaited<ReturnType<typeof open>> | null = null
    try {
      directoryHandle = await operations.open(parentPath, 'r')
      await directoryHandle.sync()
    } catch (error) {
      if (!toleratedDirectorySyncCodes.has(errorCode(error) ?? '')) throw error
    } finally {
      await directoryHandle?.close()
    }
  } finally {
    await fileHandle?.close().catch(() => undefined)
    if (tempExists) await operations.rm(tempPath, { force: true }).catch(() => undefined)
  }
}
