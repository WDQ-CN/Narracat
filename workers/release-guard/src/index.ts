// 内测「释放门控」Worker（#354）。
// 单一职责：返回一段配置 JSON，App 启动时拉取，用于软过期 / 远程急刹车。
// 改下面的 RELEASE_GATE 再 `wrangler deploy`（约 10s 生效），即可：
//   - 改内测截止日；
//   - 拉急刹车（kill=true 立即拦所有版本，紧急下线坏构建）；
//   - 抬高最低版本，逼旧版升级。
// 全程不动 App、不发新包——这就是「够不着装在网友机器上的 App」的远程开关。

interface ReleaseGate {
  /** 低于此版本则拦截（semver，如 "0.1.300"）。空串 = 不按版本拦。 */
  minVersion: string
  /** 内测截止日（ISO 8601，如 "2026-12-31T00:00:00Z"）。过了则拦截。空串 = 不按日期拦。 */
  deadline: string
  /** 急刹车：true 立即拦截所有版本。 */
  kill: boolean
  /** 展示给用户的拦截页文案。 */
  notice: string
}

// ───────────────── 改这里 ↓ 然后 wrangler deploy ─────────────────
const RELEASE_GATE: ReleaseGate = {
  minVersion: '',
  deadline: '',
  kill: false,
  notice: '内测已结束，感谢参与。请关注 narracat.com 获取公测版本。',
}
// ───────────────── 改这里 ↑ ─────────────────

export default {
  fetch(): Response {
    return new Response(JSON.stringify(RELEASE_GATE), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        // 缓存 60s：急刹车最坏 1 分钟内对所有客户端生效，又不至于每次启动都打满源站。
        'cache-control': 'public, max-age=60',
        'access-control-allow-origin': '*',
      },
    })
  },
}
