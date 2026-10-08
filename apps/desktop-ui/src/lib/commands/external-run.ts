import type {
  CommandConfig,
  CommandRunEvent,
  CommandRunRecord,
  StatusOverlayRequest,
  UserConfig,
} from '@tyco/shared'

import { commandLabel, normalizeCommands } from './command-config'
import type { CommandRunOptions, CommandRunOutcome } from './command-runner'

/** Quick commands finish before the bubble would show up */
export const PENDING_OVERLAY_DELAY_MS = 400
const SUCCESS_HIDE_MS = 1500
const ERROR_HIDE_MS = 6000

export type RunReportKind = 'info' | 'warn' | 'error' | 'success'

/** How the runner tells the user about the run, in place of a toast */
export type RunReport = (kind: RunReportKind, message: string) => void

export interface ExternalRunDependencies {
  /** Runs the command and reports how it went through `report` */
  run: (
    command: CommandConfig,
    text: string,
    report: RunReport,
    options?: CommandRunOptions
  ) => Promise<CommandRunOutcome>
  claimJob?: (id: string) => Promise<boolean>
  finishJob?: (
    id: string,
    outcome: CommandRunOutcome
  ) => Promise<CommandRunOutcome | void>
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

/**
 * Runs the commands of external calls that need no window: no text to ask for,
 * no confirmation, no result menu. Nothing is shown while a command is quick;
 * the status bubble tells the outcome, and failures also go to desktop
 * notifications, since nothing else may be in view
 */
export function createExternalRun(deps: ExternalRunDependencies) {
  const controllers = new Map<string, AbortController>()
  const handleCancel = (id: string) => controllers.get(id)?.abort()

  const failed = (name: string, message: string) => {
    deps.showOverlay({
      kind: 'error',
      text: `${name}: ${message}`,
      hideAfterMs: ERROR_HIDE_MS,
    })
    deps.notify(deps.t('externalCommand.failed', { name }), message)
  }

  const handleRun = async (
    event: CommandRunEvent
  ): Promise<CommandRunOutcome> => {
    const controller = new AbortController()
    if (event.jobId) {
      controllers.set(event.jobId, controller)
      if (deps.claimJob && !(await deps.claimJob(event.jobId))) {
        controllers.delete(event.jobId)
        return { success: false, cancelled: true }
      }
    }
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
        await deps.finishJob?.(event.jobId, outcome)
      }
      return outcome
    }

    const name = commandLabel(command)
    let reported = false
    const report: RunReport = (kind, message) => {
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
    if (input !== null) await deps.saveOutput?.(input).catch(() => {})

    let outcome: CommandRunOutcome
    try {
      outcome = await deps.run(command, input ?? '', report, {
        signal: controller.signal,
        input: event.input,
        output: event.output,
      })
    } catch (error) {
      outcome = {
        success: false,
        message: error instanceof Error ? error.message : String(error),
      }
    }
    if (controller.signal.aborted)
      outcome = { success: false, cancelled: true, message: 'Cancelled' }
    if (event.jobId) {
      controllers.delete(event.jobId)
      outcome = (await deps.finishJob?.(event.jobId, outcome)) ?? outcome
    }
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
    void Promise.resolve(deps.logRun?.(record)).catch(() => {})
    return outcome
  }

  return { handleRun, handleCancel }
}

export type ExternalRun = ReturnType<typeof createExternalRun>
