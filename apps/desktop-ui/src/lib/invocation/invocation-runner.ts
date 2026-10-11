import type { CoreToolId } from '@tyco/shared'

import type { ToolResult } from '../tools/tool-types'
import type {
  Invocation,
  InvocationOptions,
  InvocationOutcome,
} from './invocation-types'
import { createToolInvoker, type ToolInvokerDependencies } from './invoke-tool'
import { resolveSink } from './result-sinks'

export type ToastKind = 'info' | 'warn' | 'error' | 'success'

export interface InvocationRunnerDependencies extends ToolInvokerDependencies {
  showToast: (messageKey: string, type?: ToastKind) => void
  /** A toast with `messageKey` translated and `detail` after it */
  showError?: (messageKey: string, detail?: string) => void
  /** A toast with a text that needs no translation */
  showText?: (text: string, type?: ToastKind) => void
  /** Opens the action menu on `text`, the result of a run on `sourceText` */
  showResultMenu?: (text: string, sourceText: string) => void
  closeWindow?: () => void
}

/** The clipboard sink puts the output there with the tool the copy action runs */
const copyInvocation: Invocation = {
  toolId: 'core.copy' satisfies CoreToolId,
  toolConfig: {},
  label: 'core.copy',
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
  const invoke = createToolInvoker(deps)

  /** Tells the user what the tool reported */
  const report = (result: ToolResult) => {
    const level = result.level ?? (result.ok ? 'success' : 'error')
    if (result.messageKey) {
      if (level === 'error') {
        deps.showError?.(result.messageKey, result.message)
      } else {
        deps.showToast(result.messageKey, level)
      }
    } else if (result.message) {
      deps.showText?.(result.message, level)
    }
  }

  /** Opens the action menu on the output, or warns that there is none */
  const showOutput = (output: string, source: string): InvocationOutcome => {
    const text = output.replace(/[\r\n]+$/, '')
    if (!text.trim()) {
      deps.showToast('toast.actionEmptyOutput', 'warn')
      return failed('Empty output')
    }
    deps.showResultMenu?.(text, source)
    return succeeded
  }

  /** Puts the output into the clipboard, or warns that there is none */
  const copyOutput = async (
    output: string,
    keepWindow?: boolean
  ): Promise<InvocationOutcome> => {
    const text = output.replace(/[\r\n]+$/, '')
    if (!text.trim()) {
      deps.showToast('toast.actionEmptyOutput', 'warn')
      return failed('Empty output')
    }
    const result = await invoke(copyInvocation, text, { output: 'return' })
    if (result.cancelled) return cancelled
    report(result)
    if (!result.ok) {
      return failed(result.failure ?? result.message ?? 'Copy failed')
    }
    if (!keepWindow) deps.closeWindow?.()
    return succeeded
  }

  /** Reports a run that ended without output to hand on */
  const finish = (result: ToolResult): InvocationOutcome => {
    report(result)
    if (!result.keepWindow) deps.closeWindow?.()
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
    switch (resolveSink(invocation, options)) {
      case 'return':
        return { success: true, output: result.content }
      // the text did not come from a selection here: the overlay hands a
      // selection over to a selection run, see `transform`
      case 'replaceSelection':
      case 'showMenu':
        return result.content === undefined
          ? finish(result)
          : showOutput(result.content, result.sourceText ?? '')
      case 'copy':
        return copyOutput(result.content ?? '', result.keepWindow)
      case 'none':
        return finish(result)
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
  ): Promise<ToolResult> => {
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

export type InvocationRunner = ReturnType<typeof createInvocationRunner>
