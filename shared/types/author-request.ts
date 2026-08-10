/**
 * 作者给某个 Agent 写的一条要求（自由文本）。
 *
 * 产品面叫「我对它的要求」。机制上是把这段文本追加进该 Agent 的 prompt 末尾——不是 skill，
 * 没有渐进式加载、没有按需调用（spec §1.2）。故它不需要 name / description / 文件夹快照，
 * 一条就是一段话。
 */
export interface AuthorRequest {
  id: string
  agentId: string
  /** 作者原文，不做任何加工 */
  text: string
  createdAt: string
}

export interface AuthorRequestFile {
  version: 1
  requests: AuthorRequest[]
}
