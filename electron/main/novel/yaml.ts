import { parse, stringify } from 'yaml'

export function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function parseYamlRecord(source: string, label: string): Record<string, unknown> {
  let parsed: unknown

  try {
    parsed = parse(source)
  } catch (error) {
    throw new Error(`${label} 不是合法 YAML：${(error as Error).message}`)
  }

  if (!isRecord(parsed)) {
    throw new Error(`${label} 必须是 YAML object。`)
  }

  return parsed
}

export function stringifyYamlRecord(value: Record<string, unknown>): string {
  const result = stringify(value)
  return result.endsWith('\n') ? result : `${result}\n`
}

export function readString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

export function readNumber(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function readArray(record: Record<string, unknown>, key: string): unknown[] {
  const value = record[key]
  return Array.isArray(value) ? value : []
}

export function readRecord(
  record: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const value = record[key]
  return isRecord(value) ? value : {}
}
