// 更新源加速代理（开源路线图 ④）。把 update.narracat.com/<平台>/<文件名>
// 翻译成 GitHub Releases 的下载地址并转发，让国内用户不必直连 GitHub。
//
// 为什么不调 GitHub API：匿名接口 60 次/小时/IP，而 Worker 的出口 IP 高度共享，
// 必然超限。改用 GitHub 两条稳定的地址规律，版本号直接从文件名解析：
//   latest-mac.yml                  → releases/latest/download/latest-mac.yml
//   NarraCat-<版本>-mac-arm64.zip   → releases/download/v<版本>/<同名>
// 代价是「哪个版本是最新」完全由 GitHub 的 latest 标记决定——这正好成了回退开关
// （网页上把旧 release 设为 latest 即可，见 README）。
//
// 本 Worker 无密钥：发布仓是 public，资产匿名可下载。

/** 安装包所在的公开仓。与开发主仓不是同一个。 */
const RELEASE_REPO = 'pantsbang-yannik/narracat-novel-agent'
const RELEASES_BASE = `https://github.com/${RELEASE_REPO}/releases`

/** 允许的平台目录。Windows 战役落位时无需改这里。 */
const PLATFORM_DIRS = new Set(['mac-arm64', 'win-x64'])

/** electron-updater 的清单文件名（不带版本号，恒取最新 release）。 */
const MANIFEST_NAMES = new Set(['latest-mac.yml', 'latest.yml'])

/** 产物命名：NarraCat-<主.次.补>-<平台>.<扩展名>，扩展名可再带 .blockmap。 */
const ASSET_NAME_PATTERN = /^NarraCat-(\d+\.\d+\.\d+)-[a-z0-9-]+\.[a-z0-9.]+$/

export function isManifestPath(pathname: string): boolean {
  const fileName = pathname.split('/').pop() ?? ''
  return MANIFEST_NAMES.has(fileName)
}

/**
 * 把对外路径翻译成 GitHub 下载地址；无法翻译一律返回 null（调用方回 404）。
 * 这里是公网入口，白名单式判断：平台目录、文件名格式、路径层级三样都必须过。
 */
export function resolveUpstreamUrl(pathname: string): string | null {
  // 先解码再校验，避免 %2F、%2E%2E 这类编码绕过白名单。
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null
  }
  if (decoded.includes('..') || decoded.includes('\\')) return null

  const parts = decoded.replace(/^\/+/, '').split('/')
  if (parts.length !== 2) return null

  const [platform, fileName] = parts
  if (!PLATFORM_DIRS.has(platform)) return null

  if (MANIFEST_NAMES.has(fileName)) {
    return `${RELEASES_BASE}/latest/download/${fileName}`
  }

  const matched = ASSET_NAME_PATTERN.exec(fileName)
  if (!matched) return null
  return `${RELEASES_BASE}/download/v${matched[1]}/${fileName}`
}

/**
 * 透传给上游的请求头。**Range 必须透传**——electron-updater 的差量下载
 * （blockmap）靠它只取变化的字节块，丢了就退化成每次全量下载 275MB。
 */
function forwardHeaders(incoming: Headers): Headers {
  const headers = new Headers()
  for (const name of ['range', 'if-none-match', 'if-modified-since', 'accept-encoding']) {
    const value = incoming.get(name)
    if (value) headers.set(name, value)
  }
  headers.set('user-agent', 'narracat-update-proxy')
  return headers
}

/**
 * 上游响应头只白名单转发，不整份复制。
 *
 * 原因：workerd 在上游返回 gzip 时会**透明解压 body，却保留解压前的
 * content-encoding / content-length**（workerd 已知行为，因为 forwardHeaders()
 * 把客户端的 accept-encoding 转给了上游，上游因此可能选择 gzip）。若整份转发
 * 响应头，客户端会拿到「声称 gzip、长度却对不上」的响应——风险最高的是
 * latest-mac.yml，它是整套自动更新的入口也是回退的唯一开关，一旦被 gzip，
 * 版本检测可能解析失败或截断。
 *
 * 因此：content-encoding 一律不转发（交给运行时按实际 body 重新决定传输编码）；
 * 上游带 content-encoding 时 content-length 也不转发（那个长度是压缩前后不一致
 * 的根源，转发了等于把错误的账目发给客户端）。顺带效果：不会把上游可能带的
 * Set-Cookie、CSP 等无关头转给客户端——代理对外只应该暴露白名单，而不是靠黑名单
 * 事后剔除。
 */
function forwardResponseHeaders(upstream: Headers): Headers {
  const headers = new Headers()
  const upstreamEncoded = Boolean(upstream.get('content-encoding'))
  for (const name of ['content-type', 'content-length', 'etag', 'last-modified', 'accept-ranges', 'content-range']) {
    if (name === 'content-length' && upstreamEncoded) continue
    const value = upstream.get(name)
    if (value) headers.set(name, value)
  }
  return headers
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 })
    }

    const pathname = new URL(request.url).pathname
    const upstream = resolveUpstreamUrl(pathname)
    if (!upstream) return new Response('Not Found', { status: 404 })

    const upstreamResponse = await fetch(upstream, {
      method: request.method,
      headers: forwardHeaders(request.headers),
      redirect: 'follow',
    })

    const headers = forwardResponseHeaders(upstreamResponse.headers)
    // 清单是「哪个版本是最新」的唯一开关，必须不缓存——否则回退要等边缘缓存过期。
    // 包按版本号寻址、内容不可变，可以长缓存。
    headers.set('cache-control', isManifestPath(pathname) ? 'no-cache, max-age=0' : 'public, max-age=31536000, immutable')
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    })
  },
}
