# release-guard Worker（#354）

内测「软过期 + 远程急刹车」的服务端。App 启动时 `GET` 这个 Worker，拿到一段配置 JSON 决定是否拦截。
**单独服务这一条线**，不与反馈（#350）耦合。

## 它返回什么

```json
{
  "minVersion": "",   // 低于此版本则拦截（semver）；空串 = 不按版本拦
  "deadline": "",     // 内测截止日 ISO 8601；过了则拦截；空串 = 不按日期拦
  "kill": false,      // 急刹车：true 立即拦所有版本
  "notice": "内测已结束，感谢参与。请关注 narracat.com 获取公测版本。"
}
```

App 端判定逻辑（含「构建后 90 天」硬过期兜底、拉取失败 fail-open）在
`electron/main/release-guard.ts`，单测在同目录 `release-guard.test.ts`。

## 首次部署

```bash
cd workers/release-guard
bunx wrangler login          # 浏览器授权你的 Cloudflare 账号
bunx wrangler deploy         # 部署，输出形如 https://narracat-release-guard.<子域>.workers.dev
```

把输出的 URL 填进 `electron/main/release-guard-runtime.ts`：

```ts
const RELEASE_GUARD_URL = 'https://narracat-release-guard.<子域>.workers.dev'
```

> 在填上真实 URL 之前，App 端按「未配置」处理（跳过远程拉取，只保留硬过期兜底），不会误拦。

## 改截止日 / 拉急刹车

编辑 `src/index.ts` 里的 `RELEASE_GATE`，再 `bunx wrangler deploy`（约 10s 生效，客户端最坏 60s 缓存后命中）：

- **设内测截止日**：`deadline: "2026-12-31T00:00:00Z"`
- **紧急下线坏版本**：`kill: true`
- **逼旧版升级**：`minVersion: "0.1.320"`

全程不动 App、不发新包。

## 本地验证

```bash
bunx wrangler dev            # 起本地 Worker
# 另开一窗，让 App 指向本地：
NARRACAT_RELEASE_GUARD_URL=http://127.0.0.1:8787 bun run dev
# 把 src/index.ts 的 deadline 改到过去的日期 → 重启 App 应被拦；改回 → 恢复。
```
