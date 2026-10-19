import type { ScriptActionRequest } from '@tyco/shared'
import type { DesktopCall } from '../ipc/ipc-model'

export function createScriptActionClient(call: DesktopCall) {
  return {
    async executeScriptAction(request: ScriptActionRequest) {
      const response = await call('execute_script_action', { request })
      if (!response.success || !response.result) {
        throw new Error(response.error ?? 'Empty response')
      }
      return response.result
    },
    async cancelScriptAction(runId: string) {
      const response = await call('cancel_script_action', { runId })
      return response.success && response.result === true
    },
  }
}
