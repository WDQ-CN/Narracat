/**
 * 判断两个路径是否指向同一个 Novel project。
 *
 * 用于工作台刷新等场景：事件携带的 projectPath（写作侧解析）与 store 里 activeProject.path
 * （打开项目时记录）同源于用户传入路径，但任一侧若被加尾分隔符、统一分隔符或多重斜杠，
 * 严格字符串比较会误判为不同项目，导致刷新被 guard 拦截。
 *
 * 仅做渲染进程能可靠完成的格式归一：去首尾空白、Unicode NFC、统一分隔符为 /、去尾分隔符。
 * 不解析符号链接或大小写差异（需主进程 realpath），这类差异留待实跑确认后在主进程统一。
 */
export function normalizeProjectPathForCompare(path: string | undefined | null): string {
  if (!path) return ''
  return path
    .trim()
    .normalize('NFC')
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
}

export function isSameProjectPath(a: string | undefined | null, b: string | undefined | null): boolean {
  const normalizedA = normalizeProjectPathForCompare(a)
  if (!normalizedA) return false
  return normalizedA === normalizeProjectPathForCompare(b)
}
