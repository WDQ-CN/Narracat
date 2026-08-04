// PackToken：能力包 id/version 安全令牌校验——单一定义处，供 pack-store.ts、pack-manifest.ts、
// pack-publish.ts 等一切把 id/version 拼进磁盘路径（`<id>@<version>`）的调用点复用，不重复实现。
// 放在独立模块而非塞进 pack-store.ts / pack-manifest.ts 任一方，是为了避免两者互相 import 成环
// （pack-store.ts 依赖 pack-manifest.ts 的 validatePackManifest，若反过来在 pack-manifest.ts 里
// import pack-store.ts 会形成循环依赖）。

/**
 * manifest id/version 安全令牌校验：只准字母数字与 `._-`，且首字符不可为 `.`/`-`/`_`。
 * 这两个字段会被 `packVersionDirName` 直接拼进磁盘路径（`<id>@<version>`），若放行 `/`、`\`
 * 或 `..` 之类的片段，导入/发布/卸载/导出等一切路径拼接都会被带出对应根目录之外（路径穿越）。
 */
const SAFE_PACK_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function isSafePackToken(v: string): boolean {
  return SAFE_PACK_TOKEN.test(v)
}
