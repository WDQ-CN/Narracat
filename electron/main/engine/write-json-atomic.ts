// userData JSON 存储（prose-override-store / author-request-store）共用的落盘助手，解决两个问题：
//
// ① 非原子写：裸 writeFile 写到一半崩溃/强退/断电会留下截断 JSON，下次解析失败按各存储的
//    fail-soft 纪律降级为空，等于把作者的整份存量静默清零。改「写同目录临时文件 + rename」——
//    rename 在同一文件系统上是原子操作，落盘要么是完整旧内容要么是完整新内容，没有中间态。
//
// ② 并发读-改-写丢条目：两次交叠的「读全量→内存改→写全量」会互相覆盖，后写的赢，先写的那条
//    改动无声丢失。只串行化「写」这一步不够——两次读仍可能读到同一份旧快照，写谁后谁赢，先写
//    的那条改动照样丢（已用测试实测坐实：见 write-json-atomic 引入前 prose-override-store 的
//    并发 setProseOverride 复现）。故本助手把「读-改-写」整段而非仅「写」纳入同一条按路径的
//    promise 队列（withJsonFileLock），调用方把读取 + 计算 + 落盘整体包进 task，后来者才能看见
//    前者已提交的结果。

import { randomUUID } from 'node:crypto'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

async function atomicWriteOnce(storePath: string, value: unknown): Promise<void> {
  const dir = dirname(storePath)
  // 随机后缀避免并发调用互撞同名临时文件
  const tmpPath = join(dir, `.${randomUUID()}.tmp`)
  const content = `${JSON.stringify(value, null, 2)}\n`
  await mkdir(dir, { recursive: true })
  try {
    await writeFile(tmpPath, content, 'utf-8')
    await rename(tmpPath, storePath) // 同文件系统内原子替换
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => {}) // 失败时尽力清掉半成品临时文件，不留垃圾
    throw error
  }
}

// 每个 storePath 一条 promise 链：writeJsonFileAtomic 与 withJsonFileLock 共用同一条队列，
// 保证同一路径上的全部任务严格按到达顺序依次执行，互不插队、互不覆盖。
const queues = new Map<string, Promise<unknown>>()

function enqueue<T>(storePath: string, task: () => Promise<T>): Promise<T> {
  const prev = queues.get(storePath) ?? Promise.resolve()
  const run = prev.then(task, task)
  // 队列位存"已解决"的壳（吞掉失败），不让一次失败卡死后续排队的任务；
  // 真正的失败仍从 run 抛给当次调用方。
  queues.set(
    storePath,
    run.then(
      () => undefined,
      () => undefined,
    ),
  )
  return run
}

/**
 * 原子落盘一个 JSON 值：写同目录临时文件再 rename 覆盖目标，杜绝半截文件。
 * 与同路径上的 withJsonFileLock 任务共享同一条串行队列。
 * 序列化格式固定为 `${JSON.stringify(value, null, 2)}\n`，与既有三处存储保持一致，不做任何格式变更。
 *
 * 仅用于「无需先读」的直写场景（如清空重置）。若要落盘的值依赖读取现状，用 withJsonFileLock，
 * 不要在其 task 内部再调用本函数——本函数会重新排队，等于在同一条队列里等自己，必死锁。
 */
export function writeJsonFileAtomic(storePath: string, value: unknown): Promise<void> {
  return enqueue(storePath, () => atomicWriteOnce(storePath, value))
}

/**
 * 把「读现状 → 计算 → 落盘」整段包进同一条按路径的串行队列，修复并发读-改-写丢条目。
 * task 拿到的 write 是不再入队的原子写原语（避免 task 内落盘时对自己所在的队列死锁），
 * task 内必须用这个 write 落盘，不要另调外层 writeJsonFileAtomic。
 */
export function withJsonFileLock<T>(
  storePath: string,
  task: (write: (value: unknown) => Promise<void>) => Promise<T>,
): Promise<T> {
  return enqueue(storePath, () => task((value) => atomicWriteOnce(storePath, value)))
}
