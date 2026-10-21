import { reactive } from 'vue'
import { isPluginCancellation, isPluginError } from '@tyco/plugin-sdk'

export interface PluginActionDependencies {
  signal: AbortSignal
  reportError(error: unknown): void
  toast(key: string): void
}

/**
 * UI actions drop repeated clicks until completion and report failures
 * uniformly.
 */
export function createPluginAction<A extends unknown[]>(
  action: (...args: A) => void | Promise<void>,
  deps: PluginActionDependencies
) {
  const state = reactive({ isRunning: false })
  const run = async (...args: A): Promise<void> => {
    if (state.isRunning || deps.signal.aborted) return
    state.isRunning = true
    try {
      await action(...args)
    } catch (error) {
      if (deps.signal.aborted || isPluginCancellation(error)) return
      deps.reportError(error)
      deps.toast(
        isPluginError(error) ? error.messageKey : 'toast.commandFailed'
      )
    } finally {
      state.isRunning = false
    }
  }
  return { state, run }
}
