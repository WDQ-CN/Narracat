/**
 * Character chat 流式文本抽取（纯逻辑，可单测）。
 *
 * 重构后角色聊天走 raw `@anthropic-ai/sdk` Messages API（canonical Messages API），
 * 不再经 claude-agent-sdk 的 query()。本模块消费 Anthropic SDK 的流事件：
 * - content_block_delta + delta.type === 'text_delta' → 抽出 text 增量。
 *
 * 角色聊天 UI 只显示角色「打字中 / 消息逐步出现」，不展示工具调用、检索过程或思考
 * （ADR-0010）。因此只取 assistant 文本增量；tool_use 的 input_json_delta、thinking_delta
 * 等一律忽略——工具往返过程不外露给用户。
 *
 * 入参对事件形状做防御性解析，不强绑具体 SDK 运行时；既能消费真实 RawMessageStreamEvent，
 * 也能消费测试构造的最小事件对象。
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * 把一条 Anthropic 流事件解析成「本次新增文本」。
 * - content_block_delta（text_delta）→ 该 delta 文本。
 * - 其它（content_block_start/stop、message_*、input_json_delta、thinking_delta 等）→ null。
 */
export function extractTextDelta(event: unknown): string | null {
  if (!isRecord(event)) return null
  if (event.type !== 'content_block_delta') return null
  const delta = event.delta
  if (!isRecord(delta)) return null
  if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
    return delta.text
  }
  return null
}

export interface CharacterChatStreamResult {
  text: string
}

/**
 * 消费一段 Anthropic message stream 的事件，产出文本增量。返回这一段累计的文本。
 *
 * onDelta 在每次有新增 text_delta 时调用。手写工具循环里，每个模型轮（含工具往返续答）
 * 各产生一段 stream，调用方把各段的 onDelta 串起来即得整条回复；本函数只负责单段抽取。
 */
export async function consumeCharacterChatStream(
  events: AsyncIterable<unknown>,
  onDelta: (text: string) => void,
): Promise<CharacterChatStreamResult> {
  let accumulated = ''

  for await (const event of events) {
    const delta = extractTextDelta(event)
    if (delta === null) continue
    accumulated += delta
    onDelta(delta)
  }

  return { text: accumulated }
}

/**
 * 删除成对中/英文括号旁白及其内容（纯对话流不写动作神态；模型回潮时的确定性兜底）。
 * 纯对话场景下「（…）」几乎只可能是旁白，误伤正常括号的概率可接受（设计已确认）。
 */
export function stripStageDirections(text: string): string {
  return text
    .replace(/（[^（）]*）/g, '')
    .replace(/\([^()]*\)/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim()
}

/**
 * 把流式文本按空行（\n\n，含中间带空格/Tab 的空行）切成多条「气泡」。
 * 最后一条不完整的留在 buffer，等下一段 push 或 flush 收尾——保证只在确认边界处才产出。
 * 气泡内的单换行保留。纯状态对象，可单测。
 */
export interface BubbleSplitter {
  push(text: string): string[]
  flush(): string[]
}

export function createBubbleSplitter(): BubbleSplitter {
  let buffer = ''
  const BOUNDARY = /\n[ \t]*\n/

  function drain(): string[] {
    const out: string[] = []
    let match = BOUNDARY.exec(buffer)
    while (match) {
      const segment = buffer.slice(0, match.index).trim()
      if (segment) out.push(segment)
      buffer = buffer.slice(match.index + match[0].length)
      match = BOUNDARY.exec(buffer)
    }
    return out
  }

  return {
    push(text) {
      buffer += text
      return drain()
    },
    flush() {
      const rest = buffer.trim()
      buffer = ''
      return rest ? [rest] : []
    },
  }
}
