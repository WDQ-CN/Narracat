/**
 * 把立项卡第二档字段的「修改意图」拼成发给 /revise-premise 的自然语言 prompt。
 *
 * 第二档字段有下游依赖（facts / 风格指令 / 大纲编排），不直写 DB；用户在 UI 输入的新值
 * 经此 prompt 注入 /revise-premise（命令 argument-hint 本就是「卡·字段（可追加修改诉求）」）。
 * 显式声明「新值已确定、跳过讨论、直接评估」，引导命令跳过其步骤 1（讨论新值）直接做级联评估，
 * 仍走「先报告 CascadeImpactReport → 作者确认 → novel_submit_premise 落库 + 同步大纲」既有流程。
 * 零引擎改动：所有判断与落库逻辑都在 /revise-premise 命令侧。
 */
export function buildRevisePremiseEvaluationPrompt(input: {
  cardTitle: string
  fieldLabel: string
  oldValue: string
  newValue: string
}): string {
  const ref = input.fieldLabel && input.fieldLabel !== input.cardTitle
    ? `${input.cardTitle}·${input.fieldLabel}`
    : input.cardTitle
  return [
    `我要修改立项卡「${ref}」。`,
    `当前内容：${input.oldValue}`,
    `改为：${input.newValue}`,
    '新值我已确定，无需再讨论。请直接评估这次改动对已写章节的级联影响，',
    '把影响清单摆给我二次确认；我确认后再落改并同步大纲，取消则不要做任何修改。',
  ].join('\n')
}
