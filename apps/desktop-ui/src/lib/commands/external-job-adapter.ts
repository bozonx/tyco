import type { DesktopCall } from '../ipc/desktop-functions'
import type { InvocationOutcome } from '../invocation/invocation-types'

export interface ExternalJobAdapterDependencies {
  callFunction: DesktopCall
  selectionFailed?: (message: string | undefined) => void
}

/** Maps desktop job responses to the outcome understood by both runners. */
export function createExternalJobAdapter(deps: ExternalJobAdapterDependencies) {
  return {
    async claimJob(id: string): Promise<boolean> {
      const result = await deps.callFunction('claimExternalJob', [id])
      return result.success && result.result === true
    },
    async finishJob(
      id: string,
      completion: InvocationOutcome
    ): Promise<InvocationOutcome> {
      const result = await deps.callFunction('finishExternalJob', [
        id,
        completion,
      ])
      if (!result.success) return { success: false, message: result.error }
      const job = result.result
      if (!job) return completion
      if (job.state === 'failed' && job.code === 'SelectionFailed') {
        deps.selectionFailed?.(job.error)
      }
      return {
        success: job.state === 'succeeded',
        cancelled: job.state === 'cancelled',
        output: job.output,
        message: job.error,
        code: job.code,
      }
    },
  }
}
