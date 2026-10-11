import {
  resolveToolInput,
  toolCallConfig,
  toolInputKind,
  toolInputSchema,
  validateToolInput,
} from '../tools/tool-input'
import type { ToolLookup, ToolResult } from '../tools/tool-types'
import type { Invocation, InvocationOptions } from './invocation-types'
import { resolveSink } from './result-sinks'

export interface ToolInvokerDependencies {
  /** The tools the invocations run */
  tools: ToolLookup
  /** The dictation language, for tools that parse the text */
  language?: () => string | undefined
}

/** A tool result, or why the tool was not called */
export type InvokeResult = ToolResult & {
  /** Why the call failed, for the log */
  failure?: string
  code?: string
  /** The text the tool got, the source of its output */
  sourceText?: string
  /** Why the tool could not be called, as an i18n key */
  unavailable?: string
}

/**
 * Why the invocation cannot run now, as an i18n key: no such tool, the tool is
 * not available, or it cannot get its input from a text
 */
export function invocationUnavailableReason(
  invocation: Pick<Invocation, 'toolId' | 'toolConfig' | 'llmArgumentParsing'>,
  tools: ToolLookup
): string | undefined {
  const tool = tools.get(invocation.toolId)
  if (!tool) return 'commands.toolMissing'
  const reason = tool.unavailableReason?.()
  if (reason) return reason
  const kind = toolInputKind(
    tool,
    invocation.toolConfig,
    invocation.llmArgumentParsing ?? false
  )
  return kind === null ? 'commands.inputUnsupported' : undefined
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/**
 * Calls the tool of an invocation: checks that it can run, turns the text into
 * its input and runs it. Reports nothing; `failure` tells the log why a call
 * failed
 */
export function createToolInvoker(deps: ToolInvokerDependencies) {
  return async (
    invocation: Invocation,
    text: string,
    options: InvocationOptions = {}
  ): Promise<InvokeResult> => {
    const tool = deps.tools.get(invocation.toolId)
    // an explicit input needs no text, so only the tool itself can be missing
    const reason =
      options.input !== undefined
        ? tool
          ? tool.unavailableReason?.()
          : 'commands.toolMissing'
        : invocationUnavailableReason(invocation, deps.tools)
    if (!tool || reason) {
      const unavailable = reason ?? 'commands.toolMissing'
      return {
        ok: false,
        messageKey: 'toast.commandUnavailable',
        message: invocation.label,
        failure: unavailable,
        unavailable,
      }
    }
    const signal = options.signal ?? new AbortController().signal
    if (signal.aborted) return { ok: false, cancelled: true }

    const config = toolCallConfig(tool, invocation.toolConfig)
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
              llmArgumentParsing: invocation.llmArgumentParsing ?? false,
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
        ...(invocation.commandId
          ? {
              command: {
                id: invocation.commandId,
                name: invocation.label,
                logOutput: invocation.logOutput ?? false,
              },
            }
          : {}),
        wantsOutput: resolveSink(invocation, options) !== 'none',
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
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
}

export type ToolInvoker = ReturnType<typeof createToolInvoker>
