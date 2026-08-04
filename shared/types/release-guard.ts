// 内测「释放门控」契约（#354）。
// App 启动拉远程 JSON（单独的 release-guard Worker）判断是否软过期 / 触发急刹车；
// 类型为主进程（electron/main/release-guard.ts）与渲染端（拦截页）共用的 IPC 边界。

/** Worker 返回的远程门控配置。所有字段都可缺省，缺省即「该维度不拦」。 */
export interface ReleaseGateConfig {
  /** 低于此版本则拦截（semver）。缺省 / 空串表示不按版本拦。 */
  minVersion?: string
  /** 内测截止日（ISO 8601）。过了则拦截。缺省 / 空串表示不按日期拦。 */
  deadline?: string
  /** 急刹车：true 立即拦截所有版本（紧急拦坏版本，无需等截止日）。 */
  kill?: boolean
  /** 展示给用户的公告文案（拦截页正文）。 */
  notice?: string
}

/** 拦截原因。null 表示放行。 */
export type ReleaseGateReason = 'kill' | 'expired' | 'min-version' | 'hard-expired'

/** 门控判定结果（主进程 → 渲染端）。 */
export interface ReleaseGateVerdict {
  blocked: boolean
  reason: ReleaseGateReason | null
  /** 拦截时给用户看的文案；放行时为空串。 */
  notice: string
}
