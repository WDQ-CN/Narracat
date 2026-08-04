import { describe, expect, test } from 'bun:test'
import { createAgentQuitController } from './agent-quit-controller.ts'

async function flush(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

describe('agent quit controller', () => {
  test('allows quit immediately when no Agent run is active', () => {
    let prevented = 0
    const controller = createAgentQuitController({
      hasActiveRuns: () => false,
      confirmInterrupt: async () => false,
      restoreWindow: () => {},
      interruptAll: async () => {},
      quit: () => {},
    })

    controller.handleBeforeQuit({ preventDefault: () => (prevented += 1) })
    expect(prevented).toBe(0)
  })

  test('return branch cancels quit and restores the App without interrupting runs', async () => {
    let restored = 0
    let interrupted = 0
    let quit = 0
    const controller = createAgentQuitController({
      hasActiveRuns: () => true,
      confirmInterrupt: async () => false,
      restoreWindow: () => (restored += 1),
      interruptAll: async () => {
        interrupted += 1
      },
      quit: () => (quit += 1),
    })

    let prevented = 0
    controller.handleBeforeQuit({ preventDefault: () => (prevented += 1) })
    await flush()
    expect({ prevented, restored, interrupted, quit }).toEqual({
      prevented: 1,
      restored: 1,
      interrupted: 0,
      quit: 0,
    })
  })

  test('interrupt branch is single-flight and permits the follow-up app.quit', async () => {
    let interrupted = 0
    let quit = 0
    const controller = createAgentQuitController({
      hasActiveRuns: () => true,
      confirmInterrupt: async () => true,
      restoreWindow: () => {},
      interruptAll: async () => {
        interrupted += 1
      },
      quit: () => (quit += 1),
    })

    let prevented = 0
    controller.handleBeforeQuit({ preventDefault: () => (prevented += 1) })
    controller.handleBeforeQuit({ preventDefault: () => (prevented += 1) })
    await flush()
    expect({ prevented, interrupted, quit }).toEqual({ prevented: 2, interrupted: 1, quit: 1 })

    controller.handleBeforeQuit({ preventDefault: () => (prevented += 1) })
    expect(prevented).toBe(2)
  })
})
