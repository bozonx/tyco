import type { CoreOperationId } from '@tyco/shared'

import type { OperationResult } from '../operations/operation-types'
import type {
  Invocation,
  InvocationOptions,
  InvocationOutcome,
} from './invocation-types'
import {
  createOperationInvoker,
  type OperationInvokerDependencies,
} from './invoke-operation'
import { resolveSink } from './result-sinks'

type ToastKind = 'info' | 'warn' | 'error' | 'success'

export interface InvocationRunnerDependencies extends OperationInvokerDependencies {
  showToast: (messageKey: string, type?: ToastKind) => void
  /** A toast with `messageKey` translated and `detail` after it */
  showError?: (messageKey: string, detail?: string) => void
  /** A toast with a text that needs no translation */
  showText?: (text: string, type?: ToastKind) => void
  /** Opens the action menu on `text`, the result of a run on `sourceText` */
  showResultMenu?: (
    text: string,
    sourceText: string,
    meta?: Record<string, unknown>
  ) => void
  hideWindow?: () => void
}

/** Shown with a failure that has no message of its own to translate */
const FAILED_KEY = 'toast.commandFailed'

/**
 * Tells the user what a tool reported. A failure is never dropped: without a
 * way to show its text, the generic failure toast stands in
 */
export function reportResult(
  deps: Pick<
    InvocationRunnerDependencies,
    'showToast' | 'showError' | 'showText'
  >,
  result: Pick<OperationResult, 'ok' | 'level' | 'messageKey' | 'message'>
): void {
  const level = result.level ?? (result.ok ? 'success' : 'error')
  if (result.messageKey) {
    if (level === 'error' && deps.showError) {
      deps.showError(result.messageKey, result.message)
    } else {
      deps.showToast(result.messageKey, level)
    }
  } else if (result.message && deps.showText) {
    deps.showText(result.message, level)
  } else if (level === 'error') {
    if (deps.showError) deps.showError(FAILED_KEY, result.message)
    else deps.showToast(FAILED_KEY, 'error')
  }
}

/** The clipboard sink puts the output there with the tool the copy action runs */
const copyInvocation: Invocation = {
  operationId: 'core.copy' satisfies CoreOperationId,
  operationConfig: {},
  label: 'core.copy',
}

/** The paste sink types the output with the tool the insert action runs */
const insertInvocation: Invocation = {
  operationId: 'core.insert' satisfies CoreOperationId,
  operationConfig: {},
  label: 'core.insert',
}

const succeeded: InvocationOutcome = { success: true }
const failed = (message: string, code?: string): InvocationOutcome => ({
  success: false,
  message,
  ...(code ? { code } : {}),
})

const cancelled: InvocationOutcome = {
  success: false,
  cancelled: true,
  message: 'Cancelled',
}

/**
 * Runs invocations through the tool registry and hands their output to the sink
 * of the invocation context
 */
export function createInvocationRunner(deps: InvocationRunnerDependencies) {
  const invoke = createOperationInvoker(deps)

  const report = (result: OperationResult) => reportResult(deps, result)

  /** The output without its trailing line breaks, or null when it is empty */
  const outputText = (output: string): string | null => {
    const text = output.replace(/[\r\n]+$/, '')
    return text.trim() ? text : null
  }

  const emptyOutput = (): InvocationOutcome => {
    deps.showToast('toast.actionEmptyOutput', 'warn')
    return failed('Empty output')
  }

  /** Opens the action menu on the output, or warns that there is none */
  const showOutput = (
    output: string,
    source: string,
    meta?: Record<string, unknown>
  ): InvocationOutcome => {
    const text = outputText(output)
    if (text === null) return emptyOutput()
    if (meta !== undefined) {
      deps.showResultMenu?.(text, source, meta)
    } else {
      deps.showResultMenu?.(text, source)
    }
    return succeeded
  }

  /** Puts the output into the clipboard, or warns that there is none */
  const copyOutput = async (
    output: string,
    keepWindow?: boolean,
    notifySuccess?: boolean
  ): Promise<InvocationOutcome> => {
    const text = outputText(output)
    if (text === null) return emptyOutput()
    const result = await invoke(copyInvocation, text, { output: 'return' })
    if (result.cancelled) return cancelled
    if (notifySuccess !== false || !result.ok) {
      report(result)
    }
    if (!result.ok) {
      return failed(result.failure ?? result.message ?? 'Copy failed')
    }
    if (!keepWindow) deps.hideWindow?.()
    return succeeded
  }

  /**
   * Pastes the output into the window the user works in, or warns that there is
   * none
   */
  const insertOutput = async (output: string): Promise<InvocationOutcome> => {
    const text = outputText(output)
    if (text === null) return emptyOutput()
    const result = await invoke(insertInvocation, text, { output: 'return' })
    if (result.cancelled) return cancelled
    // the insertion hides the window and reports a failure on the desktop
    if (!result.ok) {
      return failed(result.failure ?? result.message ?? 'Insert failed')
    }
    return succeeded
  }

  /** Reports a run that ended without output to hand on */
  const finish = (
    result: OperationResult,
    options?: InvocationOptions
  ): InvocationOutcome => {
    if (options?.notifySuccess !== false || !result.ok) {
      report(result)
    }
    if (!result.keepWindow) deps.hideWindow?.()
    return succeeded
  }

  /** Runs `invocation` on `text`; a tool that takes no text gets none */
  const run = async (
    invocation: Invocation,
    text: string,
    options: InvocationOptions = {}
  ): Promise<InvocationOutcome> => {
    const result = await invoke(invocation, text, options)
    if (result.cancelled) return cancelled
    if (!result.ok) {
      report(result)
      return failed(
        result.failure ?? result.message ?? result.messageKey ?? 'Failed',
        result.code
      )
    }
    if (result.content !== undefined) {
      const cleaned = outputText(result.content)
      if (cleaned !== null) options.onOutput?.(cleaned)
    }
    switch (resolveSink(invocation, options)) {
      case 'return':
        return { success: true, output: result.content }
      // a text taken from a selection is handed over to a selection run
      // instead, see `transform`; here there is nothing to replace
      case 'insertIntoWindow':
        return result.content === undefined
          ? finish(result, options)
          : insertOutput(result.content)
      case 'showMenu':
        return result.content === undefined
          ? finish(result, options)
          : showOutput(result.content, result.sourceText ?? '', result.meta)
      case 'copyToClipboard':
        return result.content === undefined
          ? finish(result, options)
          : copyOutput(result.content, result.keepWindow, options.notifySuccess)
      case 'none':
        return finish(result, options)
    }
  }

  /**
   * Runs `invocation` on `text` for its output, which replaces the selection;
   * the caller reports how it went, so a tool that cannot run tells why
   */
  const transform = async (
    invocation: Invocation,
    text: string,
    options: InvocationOptions = {}
  ): Promise<OperationResult> => {
    const {
      failure: _failure,
      sourceText: _source,
      unavailable,
      ...result
    } = await invoke(invocation, text, { ...options, output: 'return' })
    return unavailable ? { ok: false, messageKey: unavailable } : result
  }

  return { run, transform }
}
