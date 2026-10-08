import type { CommandConfig, CommandRunSource } from '@tyco/shared'

import {
  resolveToolInput,
  toolCallConfig,
  toolInputSchema,
  validateToolInput,
} from '../tools/tool-input'
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
  /** Puts the output of a command into the clipboard */
  copyText?: (text: string) => Promise<void>
  /** The dictation language, for tools that parse the text */
  language?: () => string | undefined
}

export interface CommandRunOptions {
  input?: Record<string, unknown>
  output?: 'return' | 'configured'

  /** Cancels the run: the script is killed, the request is aborted */
  signal?: AbortSignal
  /** Where the command is invoked from; the action menu by default */
  source?: CommandRunSource
}

/** How a run ended; the user has been told already */
export interface CommandRunOutcome {
  success: boolean
  output?: string
  code?: string
  /** The user cancelled it; nothing was reported */
  cancelled?: boolean
  /** Why it failed, for the log */
  message?: string
}

/** A tool result, or why the tool was not called */
type InvokeResult = ToolResult & {
  /** Why the call failed, for the log */
  failure?: string
  code?: string
  /** The text the tool got, the source of its output */
  sourceText?: string
}

const succeeded: CommandRunOutcome = { success: true }
const failed = (message: string, code?: string): CommandRunOutcome => ({
  success: false,
  message,
  ...(code ? { code } : {}),
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

  /**
   * Calls the tool of `command` on `text`: checks that it can run, turns the
   * text into its input and runs it. Reports nothing; `failure` tells the log
   * why a call failed
   */
  const invoke = async (
    command: CommandConfig,
    text: string,
    options: CommandRunOptions
  ): Promise<InvokeResult> => {
    if (!command.enabled) {
      return {
        ok: false,
        level: 'warn',
        messageKey: 'toast.commandDisabled',
        failure: 'Disabled',
      }
    }
    const tool = deps.tools.get(command.toolId)
    const reason =
      options.input !== undefined
        ? tool?.unavailableReason?.()
        : commandUnavailableReason(command, deps.tools)
    if (!tool || reason) {
      return {
        ok: false,
        messageKey: 'toast.commandUnavailable',
        message: commandLabel(command),
        failure: reason ?? 'Unknown tool',
      }
    }
    const signal = options.signal ?? new AbortController().signal
    if (signal.aborted) return { ok: false, cancelled: true }

    const config = toolCallConfig(tool, command.toolConfig)
    try {
      const inputErrors =
        options.input === undefined
          ? []
          : validateToolInput(toolInputSchema(tool, config), options.input)
      if (inputErrors.length)
        return {
          ok: false,
          code: 'InvalidInput',
          failure: inputErrors.join('; '),
          message: inputErrors.join('; '),
        }
      const parsed =
        options.input !== undefined
          ? { ok: true as const, input: options.input }
          : await resolveToolInput({
              tool,
              config,
              text,
              llmArgumentParsing: command.llmArgumentParsing,
              context: { now: new Date(), signal, language: deps.language?.() },
            })
      if (signal.aborted) return { ok: false, cancelled: true }
      if (!parsed.ok) {
        return {
          ...parsed,
          code: 'InvalidInput',
          failure: parsed.message ?? parsed.messageKey ?? 'Invalid input',
        }
      }
      const result = await tool.run({
        input: parsed.input,
        config,
        source: options.source ?? 'menu',
        signal,
        command: {
          id: command.id,
          name: commandLabel(command),
          logOutput: command.logOutput,
        },
        wantsOutput:
          options.source === 'external' ||
          options.output === 'return' ||
          command.afterRun !== 'none',
      })
      if (signal.aborted) return { ok: false, cancelled: true }
      return {
        ...result,
        sourceText: Object.keys(parsed.input).length ? text : '',
      }
    } catch (error) {
      if (signal.aborted) return { ok: false, cancelled: true }
      const message = errorMessage(error)
      return {
        ok: false,
        messageKey: 'toast.commandFailed',
        message,
        failure: message,
      }
    }
  }

  /** Puts the output into the clipboard, or warns that there is none */
  const copyOutput = async (
    output: string,
    keepWindow?: boolean
  ): Promise<CommandRunOutcome> => {
    const text = output.replace(/[\r\n]+$/, '')
    if (!text.trim()) {
      deps.showToast('toast.actionEmptyOutput', 'warn')
      return failed('Empty output')
    }
    try {
      await deps.copyText?.(text)
    } catch (error) {
      const message = errorMessage(error)
      deps.showError?.('toast.commandFailed', message)
      return failed(message)
    }
    deps.showToast('toast.copied', 'success')
    if (!keepWindow) deps.closeWindow?.()
    return succeeded
  }

  /** Runs `command` on `text`; a command that takes no text gets none */
  const run = async (
    command: CommandConfig,
    text: string,
    options: CommandRunOptions = {}
  ): Promise<CommandRunOutcome> => {
    const result = await invoke(command, text, options)
    if (result.cancelled) return cancelled
    if (!result.ok) {
      report(result)
      return failed(
        result.failure ?? result.message ?? result.messageKey ?? 'Failed',
        result.code
      )
    }
    if (options.output === 'return')
      return { success: true, output: result.content }
    let outcome: CommandRunOutcome
    switch (command.afterRun) {
      // the text did not come from a selection here: the overlay hands a
      // selection over to a selection run, see `transform`
      case 'replaceSelection':
      case 'showMenu':
        outcome = showOutput(result.content ?? '', result.sourceText ?? '')
        break
      case 'copy':
        outcome = await copyOutput(result.content ?? '', result.keepWindow)
        break
      default:
        report(result)
        if (!result.keepWindow) deps.closeWindow?.()
        outcome = succeeded
    }
    return options.source === 'external'
      ? { ...outcome, output: result.content }
      : outcome
  }

  /**
   * Runs `command` on `text` for its output, which replaces the selection; the
   * caller reports how it went
   */
  const transform = async (
    command: CommandConfig,
    text: string,
    options: CommandRunOptions = {}
  ): Promise<ToolResult> => {
    const {
      failure: _failure,
      sourceText: _source,
      ...result
    } = await invoke(command, text, options)
    return result
  }

  return { run, transform }
}

export type CommandRunner = ReturnType<typeof createCommandRunner>
