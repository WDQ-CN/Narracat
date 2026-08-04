/**
 * 长驻 worker 的工具上下文供给器（A/B dogfood 修复：结构预算工具读到陈旧 config）。
 * 根因：SDK 路径每 run 一进程，config.yaml 每次新读；切片⑥改每项目长驻 utilityProcess 后，引擎
 * lazy runner 把首调时刻的 config 快照（含 estimated_total_chapters / words_per_chapter）缓存整个
 * 进程生命周期——setup 之后写入的篇幅字段永远读不到，模型重写 config.yaml 也无效。
 * 修复：按 config.yaml mtime 失效重建上下文（重建时关旧 sqlite 句柄），mtime 未变走缓存零开销。
 */
export interface CreateContextProviderArgs<C> {
  /** 读 config.yaml mtimeMs；读不到（文件暂不存在等）返回 0——与上次不同即触发重建 */
  statMtimeMs(): number
  createContext(): Promise<C>
  /** 重建前关闭旧上下文（sqlite 句柄等）；关闭失败不阻断重建 */
  closeContext?(context: C): void
}

export function createConfigWatchingContextProvider<C>(
  args: CreateContextProviderArgs<C>,
): () => Promise<C> {
  let cached: { promise: Promise<C>; mtimeMs: number } | null = null
  return function getContext(): Promise<C> {
    const mtimeMs = args.statMtimeMs()
    if (cached && cached.mtimeMs === mtimeMs) return cached.promise
    const stale = cached
    const promise = (async () => {
      if (stale) {
        try {
          args.closeContext?.(await stale.promise)
        } catch {
          // 旧上下文本身失败/关闭失败都不阻断重建
        }
      }
      return args.createContext()
    })()
    // 同步段内先落缓存再返回：并发调用不会重复重建；创建失败清缓存，下次调用重试（fail-loud 不粘死）
    cached = { promise, mtimeMs }
    promise.catch(() => {
      if (cached?.promise === promise) cached = null
    })
    return promise
  }
}
