import { errorMessage } from '@tyco/shared/value-guards'
import {
  PENDING_OVERLAY_DELAY_MS,
  ERROR_HIDE_MS,
  COMMAND_SUCCESS_HIDE_MS as SUCCESS_HIDE_MS,
} from './status-overlay-timing'
import type {
  CommandConfig,
  CommandRunEvent,
  CommandRunRecord,
  StatusOverlayRequest,
  UserConfig,
} from '@tyco/shared'

import { commandLabel } from './command-runtime'
import { normalizeCommands } from './command-config'
import type {
  InvocationOptions,
  InvocationOutcome,
} from '../invocation/invocation-types'

/** Quick commands finish before the bubble would show up */

type RunReportKind = 'info' | 'warn' | 'error' | 'success'

/** How the runner tells the user about the run, in place of a toast */
export type RunReport = (kind: RunReportKind, message: string) => void

export interface ExternalRunDependencies {
  reportError?: (error: unknown) => void
  /** Runs the command and reports how it went through `report` */
  run: (
    command: CommandConfig,
    text: string,
    report: RunReport,
    options?: InvocationOptions
  ) => Promise<InvocationOutcome>
  claimJob?: (id: string) => Promise<boolean>
  finishJob?: (
    id: string,
    outcome: InvocationOutcome
  ) => Promise<InvocationOutcome | void>
  showOverlay: (request: StatusOverlayRequest | null) => void
  /** A desktop notification: it stays in the notification history */
  notify: (summary: string, body: string) => void
  /** The run brings the current config: the quick window misses its changes */
  applyUserConfig?: (userConfig: UserConfig) => void
  logRun?: (record: CommandRunRecord) => Promise<void> | void
  /** Records a text that leaves the app with a command */
  saveOutput?: (text: string) => Promise<void>
  t: (key: string, params?: Record<string, string>) => string
}

interface ActiveExternalRun {
  controller: AbortController
  jobId?: string
  claimed: boolean
  finished: boolean
}

/**
 * Runs the commands of external calls that need no window: no text to ask for,
 * no confirmation, no result menu. Nothing is shown while a command is quick;
 * the status bubble tells the outcome, and failures also go to desktop
 * notifications, since nothing else may be in view
 */
export function createExternalRun(deps: ExternalRunDependencies) {
  let disposed = false
  const runs = new Set<ActiveExternalRun>()
  const controllers = new Map<string, AbortController>()
  const handleCancel = (id: string) => controllers.get(id)?.abort()
  // a job the backend failed to hand over or take back is not ours to run;
  // the run itself is reported either way
  const claimJob = (id: string) =>
    deps.claimJob ? deps.claimJob(id).catch(() => false) : Promise.resolve(true)
  const finishJob = (id: string, outcome: InvocationOutcome) =>
    Promise.resolve(deps.finishJob?.(id, outcome)).catch(() => undefined)

  const complete = async (
    run: ActiveExternalRun,
    outcome: InvocationOutcome
  ) => {
    if (!run.jobId || !run.claimed || run.finished) return outcome
    run.finished = true
    return (await finishJob(run.jobId, outcome)) ?? outcome
  }
  const cancelled: InvocationOutcome = { success: false, cancelled: true }

  const failed = (name: string, message: string) => {
    if (disposed) return
    deps.showOverlay({
      kind: 'error',
      text: `${name}: ${message}`,
      hideAfterMs: ERROR_HIDE_MS,
    })
    deps.notify(deps.t('externalCommand.failed', { name }), message)
  }

  const perform = async (
    event: CommandRunEvent,
    run: ActiveExternalRun
  ): Promise<InvocationOutcome> => {
    const { controller } = run
    if (event.jobId) {
      controllers.set(event.jobId, controller)
      if (!(await claimJob(event.jobId))) {
        controllers.delete(event.jobId)
        return { success: false, cancelled: true }
      }
    }
    run.claimed = Boolean(event.jobId)
    if (disposed || controller.signal.aborted) return complete(run, cancelled)
    deps.applyUserConfig?.(event.userConfig)
    const command = normalizeCommands(event.userConfig.commands).find(
      (item) => item.id === event.commandId
    )
    if (!command) {
      const message = deps.t('externalCommand.missing')
      failed(event.commandId, message)
      const outcome = { success: false, message }
      if (event.jobId) {
        controllers.delete(event.jobId)
        await complete(run, outcome)
      }
      return outcome
    }

    const name = commandLabel(command)
    let reported = false
    const report: RunReport = (kind, message) => {
      if (disposed || controller.signal.aborted) return
      reported = true
      if (kind === 'error' || kind === 'warn') {
        failed(name, message)
        return
      }
      deps.showOverlay({
        kind: kind === 'success' ? 'success' : 'info',
        text: `${name}: ${message}`,
        hideAfterMs: SUCCESS_HIDE_MS,
      })
    }

    deps.showOverlay({
      kind: 'pending',
      text: deps.t('externalCommand.running', { name }),
      delayMs: PENDING_OVERLAY_DELAY_MS,
    })
    const input = event.text ?? null
    if (input !== null)
      await deps
        .saveOutput?.(input)
        .catch((error: unknown) => deps.reportError?.(error))

    if (disposed || controller.signal.aborted) {
      if (!disposed) deps.showOverlay(null)
      return complete(run, cancelled)
    }
    let outcome: InvocationOutcome
    try {
      outcome = await deps.run(command, input ?? '', report, {
        signal: controller.signal,
        input: event.input,
      })
    } catch (error) {
      outcome = { success: false, message: errorMessage(error) }
    }
    if (controller.signal.aborted)
      outcome = { success: false, cancelled: true, message: 'Cancelled' }
    if (event.jobId) {
      controllers.delete(event.jobId)
      outcome = await complete(run, outcome)
    }
    if (disposed) return cancelled
    if (!reported) {
      if (outcome.success || outcome.cancelled) deps.showOverlay(null)
      else failed(name, outcome.message ?? deps.t('externalCommand.unknown'))
    }

    const record: CommandRunRecord = {
      commandId: command.id,
      name,
      source: 'external',
      success: outcome.success,
    }
    if (input !== null) record.text = input
    if (outcome.message) record.message = outcome.message
    void Promise.resolve()
      .then(() => deps.logRun?.(record))
      .catch((error: unknown) => deps.reportError?.(error))
    return outcome
  }

  const handleRun = async (
    event: CommandRunEvent
  ): Promise<InvocationOutcome> => {
    if (disposed) return cancelled
    const run = {
      controller: new AbortController(),
      jobId: event.jobId,
      claimed: false,
      finished: false,
    }
    runs.add(run)
    try {
      return await perform(event, run)
    } finally {
      runs.delete(run)
      if (event.jobId && controllers.get(event.jobId) === run.controller)
        controllers.delete(event.jobId)
    }
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const run of runs) {
      run.controller.abort()
      void complete(run, cancelled)
    }
    controllers.clear()
    runs.clear()
  }
  return { handleRun, handleCancel, dispose }
}
