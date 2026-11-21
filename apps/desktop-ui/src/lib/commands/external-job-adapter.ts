import type { CommandRunPayload } from '@tyco/shared'

import type { DesktopCall } from '../ipc/ipc-model'
import type { InvocationOutcome } from '../invocation/invocation-types'

export interface ExternalJobAdapterDependencies {
  call: DesktopCall
  selectionFailed?: (message: string | undefined) => void
  /** A job the backend could not finish: the run itself went as it went */
  reportError?: (error: unknown) => void
}

/** Maps desktop job responses to the outcome of the command overlay. */
export function createExternalJobAdapter(deps: ExternalJobAdapterDependencies) {
  return {
    /** What the job runs; null when it is not ours; a failed call throws */
    async claimJob(id: string): Promise<CommandRunPayload | null> {
      const result = await deps.call('claim_external_job', { id })
      if (!result.success)
        throw new Error(result.error ?? 'Could not claim the job')
      return result.result ?? null
    },
    async finishJob(
      id: string,
      completion: InvocationOutcome
    ): Promise<InvocationOutcome> {
      const result = await deps.call('finish_external_job', { id, completion })
      if (!result.success) {
        deps.reportError?.(
          new Error(result.error ?? 'Could not finish the job')
        )
        return completion
      }
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
