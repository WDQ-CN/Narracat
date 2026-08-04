export interface AgentBeforeQuitEvent {
  preventDefault: () => void
}

export interface AgentQuitControllerDeps {
  hasActiveRuns: () => boolean
  confirmInterrupt: () => Promise<boolean>
  restoreWindow: () => void
  interruptAll: () => Promise<void>
  quit: () => void
  settleTimeoutMs?: number
}

export function createAgentQuitController(deps: AgentQuitControllerDeps) {
  let allowQuit = false
  let promptOpen = false

  return {
    handleBeforeQuit(event: AgentBeforeQuitEvent): void {
      if (allowQuit || !deps.hasActiveRuns()) return
      event.preventDefault()
      if (promptOpen) return
      promptOpen = true

      void deps
        .confirmInterrupt()
        .then(async (shouldInterrupt) => {
          if (!shouldInterrupt) {
            deps.restoreWindow()
            return
          }
          await Promise.race([
            deps.interruptAll(),
            new Promise<void>((resolve) =>
              setTimeout(resolve, deps.settleTimeoutMs ?? 3_000),
            ),
          ])
          allowQuit = true
          deps.quit()
        })
        .finally(() => {
          promptOpen = false
        })
    },
  }
}
