import type { CommandConfig, CommandRunSource } from '@tyco/shared'

import { resolveToolInput, toolCallConfig } from '../tools/tool-input'
import type { ToolLookup, ToolResult } from '../tools/tool-types'
import { commandLabel, commandUnavailableReason } from './command-config'

export type ToastKind = 'info' | 'warn' | 'error' | 'success'

export interface CommandRunnerDependencies {
  /** The tools the commands run */
  tools: ToolLookup
  showToast: (messageKey: string, type?: ToastKind) => void
  /** A toast with `messageKey` translated and `detail` after it */
  showError?: (messageKey: string, detail?: string) => void
  /** A toast with a text that needs no translation */
  showText?: (text: string, type?: ToastKind) => void
  /** Opens the action menu on `text`, the result of a command on `sourceText` */
  showResultMenu?: (text: string, sourceText: string) => void
  closeWindow?: () => void
  /** The dictation language, for tools that parse the text */
  language?: () => string | undefined
}

export interface CommandRunOptions {
  /** Cancels the run: the script is killed, the request is aborted */
  signal?: AbortSignal
  /** Where the command is invoked from; the action menu by default */
  source?: CommandRunSource
}

/** How a run ended; the user has been told already */
export interface CommandRunOutcome {
  success: boolean
  /** The user cancelled it; nothing was reported */
  cancelled?: boolean
  /** Why it failed, for the log */
  message?: string
}

const succeeded: CommandRunOutcome = { success: true }
const failed = (message: string): CommandRunOutcome => ({
  success: false,
  message,
})

const cancelled: CommandRunOutcome = {
  success: false,
  cancelled: true,
  message: 'Cancelled',
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Runs the commands of the library through the tool registry and does what each
 * one says with the output: a toast, or the action menu on it
 */
export function createCommandRunner(deps: CommandRunnerDependencies) {
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

  /** Opens the action menu on the output, or warns that there is none. */
  const showOutput = (output: string, source: string): CommandRunOutcome => {
    const text = output.replace(/[\r\n]+$/, '')
    if (!text.trim()) {
      deps.showToast('toast.actionEmptyOutput', 'warn')
      return failed('Empty output')
    }
    deps.showResultMenu?.(text, source)
    return succeeded
  }

  /** Runs `command` on `text`; a command that takes no text gets none */
  const run = async (
    command: CommandConfig,
    text: string,
    options: CommandRunOptions = {}
  ): Promise<CommandRunOutcome> => {
    if (!command.enabled) {
      deps.showToast('toast.commandDisabled', 'warn')
      return failed('Disabled')
    }
    const tool = deps.tools.get(command.toolId)
    const reason = commandUnavailableReason(command, deps.tools)
    if (!tool || reason) {
      deps.showError?.('toast.commandUnavailable', commandLabel(command))
      return failed(reason ?? 'Unknown tool')
    }
    const signal = options.signal ?? new AbortController().signal
    if (signal.aborted) return cancelled

    const config = toolCallConfig(tool, command.toolConfig)
    let result: ToolResult
    /** The text the command got, the source of its output */
    let sourceText = ''
    try {
      const parsed = await resolveToolInput({
        tool,
        config,
        text,
        llmArgumentParsing: command.llmArgumentParsing,
        context: { now: new Date(), signal, language: deps.language?.() },
      })
      if (signal.aborted) return cancelled
      if (!parsed.ok) {
        report({ ...parsed, ok: false })
        return failed(parsed.message ?? parsed.messageKey ?? 'Invalid input')
      }
      if (Object.keys(parsed.input).length) sourceText = text
      result = await tool.run({
        input: parsed.input,
        config,
        source: options.source ?? 'menu',
        signal,
        command: {
          id: command.id,
          name: commandLabel(command),
          logOutput: command.logOutput,
        },
        wantsOutput: command.afterRun === 'showMenu',
      })
    } catch (error) {
      if (signal.aborted) return cancelled
      const message = errorMessage(error)
      deps.showError?.('toast.commandFailed', message)
      return failed(message)
    }

    if (result.cancelled || signal.aborted) return cancelled
    if (!result.ok) {
      report(result)
      return failed(result.message ?? result.messageKey ?? 'Failed')
    }
    if (command.afterRun === 'showMenu') {
      return showOutput(result.content ?? '', sourceText)
    }
    report(result)
    if (!result.keepWindow) deps.closeWindow?.()
    return succeeded
  }

  return { run }
}

export type CommandRunner = ReturnType<typeof createCommandRunner>
