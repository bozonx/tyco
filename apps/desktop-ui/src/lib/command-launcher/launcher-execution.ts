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
  const cancelled: InvocationOutcome = {
    success: false,
    cancelled: true,
    message: 'Cancelled',
  }

  // the backend may refuse or fail to hand a job over: then it is not ours
  const claimJob = (id: string): Promise<boolean> =>
    deps.claimJob
      ? deps.claimJob(id).catch((error: unknown) => {
          deps.reportError?.(error)
          return false
        })
      : Promise.resolve(true)
  const finishJob = (
    id: string,
    outcome: InvocationOutcome
  ): Promise<InvocationOutcome | void> => {
    try {
      return Promise.resolve(deps.finishJob?.(id, outcome)).catch(
        (error: unknown) => deps.reportError?.(error)
      )
    } catch (error) {
      deps.reportError?.(error)
      return Promise.resolve()
    }
  }

  /** Finishes the job of the external call this launcher was opened for */
  const releaseJob = (outcome: InvocationOutcome) => {
    const id = externalCall?.jobId
    externalCall = null
    return id ? finishJob(id, outcome) : Promise.resolve()
  }

  const reset = () => {
    void releaseJob(cancelled)
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
      try {
        await deps.replaceSelection(command)
        return { success: true }
      } catch (error) {
        deps.reportError?.(error)
        return { success: false, message: errorMessage(error) }
      }
    }
    const call = externalCall
    const running: LauncherStage = { kind: 'running', command }
    ui.stage.value = running
    const runController = new AbortController()
    controller = runController
    if (call?.jobId) {
      if (!(await claimJob(call.jobId))) {
        // another window has the job, or it is over: not ours to finish
        if (externalCall === call) externalCall = null
        if (ui.stage.value === running) ui.reset()
        return { success: false, cancelled: true }
      }
      // a reset while the job was being claimed has finished it already
      if (externalCall !== call) return cancelled
    }
    /** Ends a run cancelled before the command started */
    const stopEarly = async (): Promise<InvocationOutcome> => {
      if (controller === runController) controller = null
      if (call?.jobId) {
        if (externalCall === call) await releaseJob(cancelled)
        if (!disposed && ui.stage.value === running) ui.reset()
      } else if (!disposed && ui.stage.value === running) {
        // as after a cancelled run: the text stays for another try
        if (input !== null) {
          ui.inputText.value = input
          ui.stage.value = { kind: 'prepare', command, autoRun: false }
        } else {
          ui.stage.value = { kind: 'list' }
        }
      }
      return cancelled
    }
    if (disposed || runController.signal.aborted) return stopEarly()
    if (input !== null && deps.saveOutput) {
      // the history keeps the text even when the command fails
      try {
        await deps.saveOutput(input)
      } catch (error) {
        deps.reportError?.(error)
      }
    }
    if (disposed || runController.signal.aborted) return stopEarly()
    let outcome: InvocationOutcome
    try {
      outcome = await deps.run(command, input ?? '', {
        signal: runController.signal,
        source,
        input: call?.input,
      })
    } catch (error) {
      outcome = runController.signal.aborted
        ? cancelled
        : { success: false, message: errorMessage(error) }
    }
    if (disposed) return { success: false, cancelled: true }
    if (controller === runController) controller = null
    if (call?.jobId) {
      // a reset meanwhile has finished the job as cancelled already
      if (externalCall === call) {
        outcome = (await releaseJob(outcome)) ?? outcome
      } else {
        outcome = cancelled
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
