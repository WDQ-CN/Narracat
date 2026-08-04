// Lint 规则严重级映射：发布拦截（pack-publish.ts）与导入扫描展示（pack-store.ts）共用同一份，
// 避免两处各自维护判据表分叉（B2 刀3）。抽成独立模块而非让 pack-store.ts 反向 import pack-publish.ts，
// 是为了不在两个互相依赖的 store 模块间引入循环 import（pack-publish.ts 已经 import pack-store.ts 的
// listCapabilityPacks/packVersionDirName/userPacksDir）。
//
// 分级依据（详见原 pack-publish.ts 注释）：`system-prompt-directive-cn` 有残余误杀面——系统流网文里
// 角色脑内面板弹出「系统提示：您已切换至暴走模式」这类合法叙事仍会命中该规则，故降级为 warn（发布场景需
// 作者确认放行；导入场景只展示不阻断）。其余规则（工具名外泄/指挥引擎/无视纪律等）误杀面小，维持 block。
// 未登记的新规则名默认从严（block）——fail-safe，避免以后加规则忘记登记本映射而静默放行/漏报。
export const LINT_RULE_SEVERITY: Record<string, 'block' | 'warn'> = {
  'ignore-prior-instructions': 'block',
  'mandate-tool-call': 'block',
  'tool-name-exposed': 'block',
  'ignore-outline-discipline': 'block',
  'system-prompt-injection': 'block',
  'system-prompt-directive-cn': 'warn',
  'every-chapter-mandate': 'block',
}

export function lintSeverity(rule: string): 'block' | 'warn' {
  return LINT_RULE_SEVERITY[rule] ?? 'block'
}
