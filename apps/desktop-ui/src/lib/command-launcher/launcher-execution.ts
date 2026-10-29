import { errorMessage } from '@tyco/shared/value-guards'
import type {
  CommandConfig,
  CommandRunRecord,
  CommandRunSource,
  LauncherRequest,
} from '@tyco/shared'
import type { Ref, ShallowRef } from 'vue'

import { commandAfterRun } from '../commands/command-runtime'
import { commandRunRecord, logCommandRun } from '../commands/command-run-record'
import type {
  InvocationOptions,
  InvocationOutcome,
} from '../invocation/invocation-types'

/**
 * What the overlay shows:
 *
 * - `list` — the commands, with the search;
 * - `prepare` — one command before it runs: the text it takes, typed or taken
 *   from the selection. `autoRun`: the command runs as soon as the selection
 *   comes; not after a failed run, whose text stays for another try;
 * - `running` — the command is on its way.
 */
export type LauncherStage =
  | { kind: 'list' }
  | { kind: 'prepare'; command: CommandConfig; autoRun: boolean }
  | { kind: 'running'; command: CommandConfig }

export interface LauncherExecutionDependencies {
  reportError?: (error: unknown) => void
  claimJob?: (id: string) => Promise<boolean>
  finishJob?: (
    id: string,
    outcome: InvocationOutcome
  ) => Promise<InvocationOutcome | void>
  /** Runs the command and tells the user how it went */
  run: (
    command: CommandConfig,
    text: string,
    options?: InvocationOptions
  ) => Promise<InvocationOutcome>
  /**
   * Hands a command whose output replaces the selection over to a selection
   * run: the overlay hides, and the selection is replaced where it is
   */
  replaceSelection?: (command: CommandConfig) => Promise<void>
  /** Records a text that leaves the app with a command */
  saveOutput?: (text: string) => Promise<void>
  logRun?: (record: CommandRunRecord) => Promise<void> | void
}

/** Owns command cancellation, external jobs and completion reporting. */
export function createLauncherExecution(
  deps: LauncherExecutionDependencies,
  ui: {
    stage: ShallowRef<LauncherStage>
    inputText: Ref<string>
    fromSelection: () => boolean
    reset: () => void
  }
) {
  let disposed = false
  let source: CommandRunSource = 'launcher'
  let controller: AbortController | null = null
  let externalCall: LauncherRequest | null = null

  const reset = () => {
    if (externalCall?.jobId)
      void deps.finishJob?.(externalCall.jobId, {
        success: false,
        cancelled: true,
        message: 'Cancelled',
      })
    externalCall = null
    controller?.abort()
    controller = null
    source = 'launcher'
  }

  const log = (
    command: CommandConfig,
    input: string | null,
    outcome: InvocationOutcome
  ) => {
    logCommandRun(deps, commandRunRecord(command, source, input, outcome))
  }

  const execute = async (
    command: CommandConfig,
    input: string | null
  ): Promise<InvocationOutcome> => {
    if (
      source === 'launcher' &&
      commandAfterRun(command, source) === 'insertIntoWindow' &&
      input !== null &&
      ui.fromSelection() &&
      deps.replaceSelection
    ) {
      // the selection run reports and logs the outcome itself
      ui.reset()
      await deps.replaceSelection(command)
      return { success: true }
    }
    const call = externalCall
    const running: LauncherStage = { kind: 'running', command }
    ui.stage.value = running
    const runController = new AbortController()
    controller = runController
    if (call?.jobId && deps.claimJob && !(await deps.claimJob(call.jobId))) {
      // another window has the job, or it is over: not ours to finish
      if (externalCall === call) externalCall = null
      ui.reset()
      return { success: false, cancelled: true }
    }
    if (disposed || runController.signal.aborted)
      return { success: false, cancelled: true }
    if (input !== null) {
      // the history keeps the text even when the command fails
      await deps
        .saveOutput?.(input)
        .catch((error: unknown) => deps.reportError?.(error))
    }
    if (disposed || runController.signal.aborted)
      return { success: false, cancelled: true }
    let outcome: InvocationOutcome
    try {
      outcome = await deps.run(command, input ?? '', {
        signal: runController.signal,
        source,
        input: call?.input,
      })
    } catch (error) {
      outcome = runController.signal.aborted
        ? { success: false, cancelled: true, message: 'Cancelled' }
        : { success: false, message: errorMessage(error) }
    }
    if (disposed) return { success: false, cancelled: true }
    if (controller === runController) controller = null
    if (call?.jobId) {
      // a reset meanwhile has finished the job as cancelled already
      if (externalCall === call) {
        externalCall = null
        outcome = (await deps.finishJob?.(call.jobId, outcome)) ?? outcome
      } else {
        outcome = { success: false, cancelled: true, message: 'Cancelled' }
      }
      if (disposed) return { success: false, cancelled: true }
      log(command, input, outcome)
      if (ui.stage.value === running) ui.reset()
      return outcome
    }
    log(command, input, outcome)
    // a new activation started over meanwhile
    if (ui.stage.value !== running) return outcome
    if (outcome.success) {
      ui.reset()
    } else if (input !== null) {
      // the text stays for another try
      ui.inputText.value = input
      ui.stage.value = { kind: 'prepare', command, autoRun: false }
    } else {
      ui.stage.value = { kind: 'list' }
    }
    return outcome
  }

  return {
    execute,
    reset,
    get source() {
      return source
    },
    get externalCall() {
      return externalCall
    },
    useLauncher() {
      source = 'launcher'
    },
    prepare(call: LauncherRequest | null) {
      source = call ? 'external' : 'launcher'
      externalCall = call
    },
    cancel: () => controller?.abort(),
    dispose() {
      if (disposed) return
      disposed = true
      reset()
    },
  }
}
