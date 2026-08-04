import { describe, expect, test } from 'bun:test'
import {
  createEmptyDurableAgentThread,
  reduceAgentDurableEvent,
} from './agent-durable-events'

describe('durable Agent conversation boundaries', () => {
  test('uses only the new segment divider for an explicit new conversation', () => {
    const thread = createEmptyDurableAgentThread('novel:stars')
    const invalidated = reduceAgentDurableEvent(thread, {
      type: 'session.invalidated',
      reason: 'new-conversation',
      createdAt: '2026-07-24T12:00:00.000Z',
    })
    const divided = reduceAgentDurableEvent(invalidated, {
      type: 'conversation.divider-added',
      dividerId: 'divider-seg-2',
      createdAt: '2026-07-24T12:00:00.000Z',
    })

    expect(invalidated.messages).toEqual([])
    expect(divided.messages.map((message) => message.role)).toEqual(['divider'])
  })
})
