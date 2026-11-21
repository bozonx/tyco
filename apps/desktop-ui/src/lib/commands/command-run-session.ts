import { shallowRef } from 'vue'

import { errorMessage } from '@tyco/shared/value-guards'
import type {
  AccessDecision,
  CommandConfig,
  CommandRunPayload,
  CommandRunRecord,
  CommandRunRequest,
  UserConfig,
} from '@tyco/shared'

import type {
  InvocationOptions,
  InvocationOutcome,
} from '../invocation/invocation-types'
import { normalizeCommands } from './command-config'
import { commandLabel } from './command-runtime'
import { commandRunRecord, logCommandRun } from './command-run-record'

/** The code of a job the backend stopped over its limit */
const TIMED_OUT_CODE = 'TimedOut'

/**
 * Where the run is: asking for access to the selection, asking for the text,
 * running, or over. `idle` shows nothing
 */
export type CommandRunPhase =
  'idle' | 'access' | 'input' | 'running' | 'result' | 'failed' | 'cancelled'

export type CommandRunReportKind = 'info' | 'warn' | 'error' | 'success'

export interface CommandRunState {
  phase: CommandRunPhase
  jobId?: string
  commandName: string
  /** The output replaces the selection: the overlay hides for it */
  shouldReplace: boolean
  /** Started by a caller outside Tyco */
  isExternal: boolean
  /** The last progress or warning the run reported */
  status?: { kind: CommandRunReportKind; text: string }
  /** The text the run returned, for `result` */
  output?: string
  /** The text the output was made from, for the action menu on it */
  sourceText?: string
  /** Why the run failed or ended, for `failed` and `cancelled` */
  message?: string
}

/** What the runner hands back besides the outcome */
export interface CommandRunHooks {
  report: (kind: CommandRunReportKind, text: string) => void
  /** The output the command wants shown, e.g. its output action is the menu */
  showResult: (text: string, sourceText: string) => void
}

export interface CommandRunSessionDependencies {
  /** Takes the job; `null` when it is gone, taken or may not run any more */
  claim: (jobId: string) => Promise<CommandRunPayload | null>
  answerAccess: (jobId: string, decision: AccessDecision) => Promise<void>
  /** Finishes the job and returns how it ended up, e.g. a failed replacement */
  finish: (
    jobId: string,
    outcome: InvocationOutcome
  ) => Promise<InvocationOutcome | void>
  cancelJob: (jobId: string) => Promise<void>
  run: (
    command: CommandConfig,
    text: string,
    hooks: CommandRunHooks,
    options: InvocationOptions
  ) => Promise<InvocationOutcome>
  /** The command takes a text the overlay has to ask for */
  takesText: (command: CommandConfig) => boolean
  /** Hides the overlay */
  hide: () => void
  /** The run brings the current config: the quick window misses its changes */
  applyUserConfig?: (userConfig: UserConfig) => void
  logRun?: (record: CommandRunRecord) => Promise<void> | void
  /** Records a text that leaves the app with a command */
  saveOutput?: (text: string) => Promise<void>
  reportError?: (error: unknown) => void
  t: (key: string, params?: Record<string, string>) => string
}

const IDLE: CommandRunState = {
  phase: 'idle',
  commandName: '',
  shouldReplace: false,
  isExternal: false,
}

const ACTIVE_PHASES = new Set<CommandRunPhase>(['access', 'input', 'running'])

interface ActiveRun {
  request: CommandRunRequest
  controller: AbortController
  command?: CommandConfig
  payload?: CommandRunPayload
  /** The user ended it: nothing more is shown */
  isDismissed: boolean
  /** The run reached the backend with its outcome: it cannot be cancelled */
  isFinishing: boolean
  isAccessAnswered: boolean
  /** Resolves once the run is over, whatever the way */
  settled: Promise<void>
  settle: () => void
}

/**
 * One visible run of a library command in the command overlay, whoever started
 * it. It asks for access and text when needed, runs the command, shows the
 * result and hands the outcome to the backend job. The backend lets one run at
 * a time; Esc ends it explicitly
 */
export function createCommandRunSession(deps: CommandRunSessionDependencies) {
  const state = shallowRef<CommandRunState>(IDLE)
  let active: ActiveRun | undefined
  let disposed = false

  const isCurrent = (run: ActiveRun) => active === run && !disposed
  const update = (run: ActiveRun, patch: Partial<CommandRunState>) => {
    if (isCurrent(run)) state.value = { ...state.value, ...patch }
  }
  const end = (run: ActiveRun, patch: Partial<CommandRunState>) => {
    update(run, patch)
    run.settle()
  }

  const reportError = (error: unknown) => deps.reportError?.(error)
  const finishJob = async (
    run: ActiveRun,
    outcome: InvocationOutcome
  ): Promise<InvocationOutcome> => {
    run.isFinishing = true
    try {
      return (await deps.finish(run.request.jobId, outcome)) ?? outcome
    } catch (error) {
      reportError(error)
      return outcome
    }
  }

  const fail = async (run: ActiveRun, message: string) => {
    await finishJob(run, { success: false, message })
    end(run, { phase: 'failed', message })
  }

  const execute = async (run: ActiveRun, text: string | null) => {
    const command = run.command
    const payload = run.payload
    if (!command || !payload) return
    update(run, { phase: 'running', status: undefined })
    let lastError: string | undefined
    let lastWarning: string | undefined
    let shownResult: { text: string; sourceText: string } | undefined
    const hooks: CommandRunHooks = {
      report: (kind, message) => {
        if (run.controller.signal.aborted) return
        if (kind === 'error') lastError = message
        if (kind === 'warn') lastWarning = message
        update(run, { status: { kind, text: message } })
      },
      showResult: (output, sourceText) => {
        shownResult = { text: output, sourceText }
      },
    }
    let outcome: InvocationOutcome
    if (run.controller.signal.aborted) {
      outcome = { success: false, cancelled: true, message: 'Cancelled' }
    } else {
      try {
        outcome = await deps.run(command, text ?? '', hooks, {
          signal: run.controller.signal,
          input: payload.input,
          source: run.request.isExternal ? 'external' : 'menu',
          // a call with `--selection` fills `{{SELECTION}}` as well
          ...(payload.selectionText != null
            ? { context: { selectionText: payload.selectionText } }
            : {}),
        })
      } catch (error) {
        outcome = { success: false, message: errorMessage(error) }
      }
    }
    // a cancelled job never publishes a late result
    if (run.controller.signal.aborted)
      outcome = { success: false, cancelled: true, message: 'Cancelled' }
    if (shownResult && outcome.success && outcome.output === undefined)
      outcome = { ...outcome, output: shownResult.text }
    const final = await finishJob(run, outcome)
    // the text left the app only if the command ran: a refused, failed or
    // cancelled run does not put it into the history
    if (text !== null && final.success)
      void Promise.resolve()
        .then(() => deps.saveOutput?.(text))
        .catch(reportError)
    if (!final.cancelled || final.code === TIMED_OUT_CODE)
      logCommandRun(
        deps,
        commandRunRecord(
          command,
          run.request.isExternal ? 'external' : 'menu',
          text,
          final
        )
      )
    if (run.isDismissed) {
      end(run, { phase: 'cancelled' })
      return
    }
    if (final.code === TIMED_OUT_CODE) {
      end(run, {
        phase: 'failed',
        message: deps.t('commandRun.timedOut', {
          seconds: String(command.runTimeoutSec),
        }),
      })
    } else if (final.cancelled) {
      end(run, { phase: 'cancelled', message: deps.t('commandRun.cancelled') })
    } else if (!final.success) {
      end(run, {
        phase: 'failed',
        message:
          lastError ??
          lastWarning ??
          final.message ??
          deps.t('commandRun.failedUnknown'),
      })
    } else if (run.request.replace) {
      // the backend hid the overlay and put the output into the selection
      end(run, { phase: 'result', output: final.output })
    } else {
      const output = shownResult?.text ?? final.output
      if (output === undefined) {
        // the output went where the command sends it: nothing is left to show
        end(run, { phase: 'result' })
        if (isCurrent(run)) deps.hide()
        return
      }
      end(run, {
        phase: 'result',
        output,
        sourceText: shownResult?.sourceText ?? text ?? '',
        ...(output.trim()
          ? {}
          : { message: deps.t('commandRun.noOutput'), output: '' }),
      })
    }
  }

  /** Takes the job and runs it, or asks for the text first */
  const proceed = async (run: ActiveRun) => {
    let payload: CommandRunPayload | null
    try {
      payload = await deps.claim(run.request.jobId)
    } catch (error) {
      reportError(error)
      payload = null
    }
    if (!isCurrent(run) || run.isDismissed) {
      if (payload) await finishJob(run, { success: false, cancelled: true })
      run.settle()
      return
    }
    if (!payload) {
      // the backend ended the job with the reason the caller gets
      end(run, { phase: 'failed', message: deps.t('commandRun.unavailable') })
      return
    }
    run.payload = payload
    deps.applyUserConfig?.(payload.userConfig)
    const command = normalizeCommands(payload.userConfig.commands).find(
      (item) => item.id === payload.commandId
    )
    if (!command) {
      await fail(run, deps.t('commandRun.missing'))
      return
    }
    run.command = command
    update(run, { commandName: commandLabel(command) })
    if (
      payload.text == null &&
      payload.input == null &&
      deps.takesText(command)
    ) {
      update(run, { phase: 'input' })
      return
    }
    await execute(run, payload.text ?? null)
  }

  /** Shows the run of a new `commandRun` activation */
  const open = (request: CommandRunRequest): Promise<void> => {
    if (disposed) return Promise.resolve()
    if (active?.request.jobId === request.jobId) return active.settled
    // the backend runs one job at a time; one left over has lost its window
    if (active) void leave()
    let settle!: () => void
    const settled = new Promise<void>((resolve) => {
      settle = resolve
    })
    const run: ActiveRun = {
      request,
      controller: new AbortController(),
      isDismissed: false,
      isFinishing: false,
      isAccessAnswered: false,
      settled,
      settle,
    }
    active = run
    state.value = {
      phase: request.needsAccess ? 'access' : 'running',
      jobId: request.jobId,
      commandName: request.commandName,
      shouldReplace: request.replace,
      isExternal: request.isExternal,
    }
    if (!request.needsAccess)
      void proceed(run).catch((error: unknown) => {
        reportError(error)
        end(run, { phase: 'failed', message: errorMessage(error) })
      })
    return settled
  }

  const respondAccess = async (decision: AccessDecision) => {
    const run = active
    if (!run || state.value.phase !== 'access' || run.isAccessAnswered) return
    run.isAccessAnswered = true
    try {
      await deps.answerAccess(run.request.jobId, decision)
    } catch (error) {
      // the job is left to its timeout, which tells the caller
      reportError(error)
    }
    if (decision === 'deny') {
      end(run, { phase: 'cancelled' })
      if (isCurrent(run)) deps.hide()
      return
    }
    if (!isCurrent(run)) return
    update(run, { phase: 'running' })
    await proceed(run)
  }

  const submitText = async (text: string) => {
    const run = active
    if (!run || state.value.phase !== 'input') return
    await execute(run, text)
  }

  /** Ends the run without hiding; a finished run has nothing to end */
  const stop = async (run: ActiveRun) => {
    const phase = state.value.phase
    if (!ACTIVE_PHASES.has(phase) || run.isFinishing || run.isDismissed) return
    run.isDismissed = true
    if (phase === 'access') {
      run.isAccessAnswered = true
      await deps.answerAccess(run.request.jobId, 'deny').catch(reportError)
      end(run, { phase: 'cancelled' })
      return
    }
    run.controller.abort()
    await deps.cancelJob(run.request.jobId).catch(reportError)
    // a run waiting for its text or its claim has nothing else to end it
    if (phase === 'input' || !run.command) end(run, { phase: 'cancelled' })
  }

  /** Esc or the close button: cancels a run, closes a finished one */
  const cancel = async () => {
    const run = active
    if (!run) return
    deps.hide()
    await stop(run)
    if (isCurrent(run) && !ACTIVE_PHASES.has(state.value.phase))
      state.value = IDLE
  }

  /** The window went to another mode or hid: the run has no one to show it */
  const leave = async () => {
    const run = active
    if (!run) return
    await stop(run)
    await run.settled
  }

  /** The backend cancelled the job: its caller or its time limit */
  const handleJobCancelled = (jobId: string) => {
    const run = active
    if (!run || run.request.jobId !== jobId) return
    if (run.command && state.value.phase === 'running') {
      run.controller.abort()
      return
    }
    if (ACTIVE_PHASES.has(state.value.phase)) {
      run.controller.abort()
      end(run, { phase: 'cancelled', message: deps.t('commandRun.cancelled') })
    }
  }

  const dispose = () => {
    if (disposed) return
    const run = active
    if (run && ACTIVE_PHASES.has(state.value.phase) && !run.isFinishing) {
      run.isDismissed = true
      run.controller.abort()
      void deps.cancelJob(run.request.jobId).catch(reportError)
    }
    disposed = true
    active = undefined
  }

  return {
    state,
    open,
    respondAccess,
    submitText,
    cancel,
    leave,
    handleJobCancelled,
    /** A run asks for access, for text or runs */
    isActive: () => ACTIVE_PHASES.has(state.value.phase),
    dispose,
  }
}
