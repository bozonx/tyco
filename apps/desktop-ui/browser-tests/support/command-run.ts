import { ActivationMode, DESKTOP_EVENTS } from '@tyco/shared'

import type { FakeDesktop } from './fake-desktop'

/**
 * The backend side of a command started from the action menu: it opens a
 * `commandRun` activation for the job, hands the job to the overlay and takes
 * the outcome back, as the Rust job queue does.
 */
export function installCommandRun(desktop: FakeDesktop) {
  const jobs = new Map<string, { commandId: string; text: string | null }>()
  let jobCount = 0
  let revision = 100

  desktop.handle('start_command_run', async (args) => {
    const { commandId, text } = args as { commandId: string; text?: string }
    const command = desktop.userConfig.commands.find(
      (item) => item.id === commandId
    )
    const jobId = `job-${++jobCount}`
    jobs.set(jobId, { commandId, text: text ?? null })
    const state = desktop.snapshot()
    await desktop.emit(DESKTOP_EVENTS.STATE_CHANGED, {
      ...state,
      revision: revision++,
      window: { ...state.window, isWindowShown: true },
      activation: {
        ...state.activation,
        mode: ActivationMode.COMMAND_RUN,
        activationId: state.activation.activationId + 1,
        commandRun: {
          jobId,
          commandId,
          commandName: command?.name ?? commandId,
          needsAccess: false,
          replace: false,
          isExternal: false,
        },
      },
    })
    return { id: jobId, commandId, state: 'accepted' }
  })
  desktop.handle('claim_external_job', (args) => {
    const job = jobs.get((args as { id: string }).id)
    if (!job) return null
    return {
      commandId: job.commandId,
      ...(job.text === null ? {} : { text: job.text }),
      userConfig: desktop.userConfig,
    }
  })
  desktop.handle('finish_external_job', (args) => {
    const { id, completion } = args as {
      id: string
      completion: { success: boolean; cancelled?: boolean; output?: string }
    }
    return {
      id,
      commandId: jobs.get(id)?.commandId ?? '',
      state: completion.cancelled
        ? 'cancelled'
        : completion.success
          ? 'succeeded'
          : 'failed',
      output: completion.output,
    }
  })
}
