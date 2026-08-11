# narracat-update Worker（开源路线图 ④）

更新源加速代理。把 `update.narracat.com/<平台>/<文件名>` 转发到 GitHub Releases
（`pantsbang-yannik/narracat-novel-agent`，已 public），让国内用户下载更稳。
**无密钥**——发布仓资产匿名可下载，本 Worker 不需要任何 secret。

## 首次部署

```bash
cd workers/narracat-update
bunx --bun wrangler deploy   # 会自动创建 update.narracat.com 的自定义域与 DNS 记录
```

部署后验证：

```bash
curl -sI https://update.narracat.com/mac-arm64/latest-mac.yml
# 应为 200
```

## 回退怎么做

出了坏版本，**不需要传任何文件、不需要命令行**：

1. 打开 GitHub 网页 → 发布仓（`pantsbang-yannik/narracat-novel-agent`）→ Releases
2. 编辑上一个正常的 release → 勾选 "Set as the latest release" → 保存
3. 随后 `curl https://update.narracat.com/mac-arm64/latest-mac.yml` 应立刻返回旧版本号

备选：把出问题的 release 直接改成 draft（同样会从 `releases/latest` 消失）。

## 发版为什么不能勾 Pre-release

`releases/latest`（本 Worker 唯一依赖的地址）不包含标了 Pre-release 的版本。
勾了它，这个 Worker 就找不到最新版，整条自动更新链断掉。「内测版」三个字写在
release 标题里表达即可，不要勾这个选项。

## 降级方案

Cloudflare 服务条款限制用 CDN 大量传输非网页内容。内测规模风险低，但如果收到
Cloudflare 的提醒邮件，把 `src/index.ts` 里 `fetch` 的转发逻辑换成
`Response.redirect(upstream, 302)` 即可——用户改为直连 GitHub，失去加速但功能
不受影响。

## 本地验证

```bash
bunx --bun wrangler dev
curl -sI http://127.0.0.1:8787/mac-arm64/latest-mac.yml
```
