// 语料服务客户端配置解析（spec: docs/superpowers/specs/2026-08-05-corpus-server-design.md §4）。
// token 读取顺序：env（维护者 dev）→ 构建期注入（官方打包流水线）→ 空（fork 默认态，禁用远程取范例）。
// 构建期注入见 electron.vite.config.ts main.define；bun 单测等未走 vite 的环境按未注入处理。
declare const __NARRACAT_CORPUS_TOKEN__: string | undefined

export interface CorpusClientEnv {
  token: string
  url?: string
  dir?: string
}

export function resolveCorpusClientEnv(): CorpusClientEnv {
  const injected = typeof __NARRACAT_CORPUS_TOKEN__ === 'string' ? __NARRACAT_CORPUS_TOKEN__.trim() : ''
  const token = process.env.NARRACAT_CORPUS_TOKEN?.trim() || injected
  const url = process.env.NARRACAT_CORPUS_URL?.trim()
  const dir = process.env.NARRACAT_CORPUS_DIR?.trim()
  return { token, ...(url ? { url } : {}), ...(dir ? { dir } : {}) }
}
