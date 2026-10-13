import type { ScriptActionRequest } from '@tyco/shared'
import type { DesktopCall } from '../ipc/desktop-functions'

export function createScriptActionClient(callFunction: DesktopCall) {
  return {
    async executeScriptAction(request: ScriptActionRequest) {
      const response = await callFunction('executeScriptAction', [request])
      if (!response.success || !response.result) {
        throw new Error(response.error ?? 'Empty response')
      }
      return response.result
    },
    async cancelScriptAction(runId: string) {
      const response = await callFunction('cancelScriptAction', [runId])
      return response.success && response.result === true
    },
  }
}
