// 卡正文红线检查：识别卡内容里试图指挥/越权操纵引擎的语句（提示注入类风险），
// 而非评审写作质量。主进程（Task 7 发布阻断）与渲染端（Task 9 导入警示）共用同一份纯函数。

export interface CardLintFinding {
  line: number
  excerpt: string
  rule: string
}

interface LintRule {
  rule: string
  pattern: RegExp
}

/** 摘录截断长度（字符数）。 */
const EXCERPT_MAX_LENGTH = 40

const LINT_RULES: LintRule[] = [
  { rule: 'ignore-prior-instructions', pattern: /忽略(以上|之前|前面).{0,6}(设定|指令|要求|提示)/ },
  { rule: 'mandate-tool-call', pattern: /(必须|请)调用\s*novel_/ },
  // 前置负向断言防止前缀粘连（如 mynovel_reader）误杀合法标识符片段。
  { rule: 'tool-name-exposed', pattern: /(?<![a-zA-Z0-9_])novel_[a-z_]+/ },
  { rule: 'ignore-outline-discipline', pattern: /无视.{0,8}(章纲|大纲|设定|纪律)/ },
  { rule: 'system-prompt-injection', pattern: /(system prompt|开发者模式)/i },
  // 「系统提示」单独出现是系统流网文合法叙事（如角色脑内面板），须伴随指令语境词才判定为红线。
  { rule: 'system-prompt-directive-cn', pattern: /系统提示.{0,12}(切换|忽略|无视|进入|你现在|开发者)/ },
  { rule: 'every-chapter-mandate', pattern: /每章都(要|必须)/ },
]

/**
 * 逐行扫描卡正文，检出指挥/越权操纵引擎类语句。纯函数，无命中返回空数组。
 * 同一行命中多条规则时每条规则各报一条 finding（发布阻断场景多报无害，信息更全）。
 */
export function lintCardBody(body: string): CardLintFinding[] {
  const findings: CardLintFinding[] = []
  const lines = body.split('\n')
  lines.forEach((lineText, index) => {
    for (const { rule, pattern } of LINT_RULES) {
      if (pattern.test(lineText)) {
        findings.push({
          line: index + 1,
          excerpt: lineText.slice(0, EXCERPT_MAX_LENGTH),
          rule,
        })
      }
    }
  })
  return findings
}
