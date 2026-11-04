import {
  cancelledToolResult,
  isPluginError,
  isPluginCancellation,
} from '@tyco/plugin-sdk'
import { errorMessage } from '@tyco/shared/value-guards'
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
import { outputRequest, toolCallCommand } from '../tools/tool-call'
import {
  commandMissingVariables,
  isOnPlatform,
  type CommandEnvironment,
} from '../variables/command-variables'

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
  invocation: Pick<
    Invocation,
    'toolId' | 'toolConfig' | 'isLlmArgumentParsingEnabled' | 'platforms'
  >,
  tools: ToolLookup
): string | undefined {
  const tool = tools.get(invocation.toolId)
  if (!tool) return 'commands.toolMissing'
  const reason = tool.getUnavailableReasonKey?.()
  if (reason) return reason
  const environment = tools.environment?.()
  if (environment) {
    // the config is shared by devices: a command of another platform, or one
    // whose variables this device has no values for, stays but does not run
    if (!isOnPlatform(invocation.platforms, environment.platform))
      return 'commands.otherPlatform'
    if (invocationMissingVariables(invocation, environment).length)
      return 'commands.variablesNotSet'
  }
  // a tool that writes notes needs the folder, set on each device in the
  // plugin settings or in the command
  const notesField = tool.directoryFieldName
  if (
    notesField &&
    tool.configFields?.some((field) => field.name === notesField) &&
    !String(
      toolCallConfig(tool, invocation.toolConfig)[notesField] ?? ''
    ).trim()
  )
    return 'commands.notesFolderMissing'
  const kind = toolInputKind(
    tool,
    invocation.toolConfig,
    invocation.isLlmArgumentParsingEnabled ?? false
  )
  return kind === null ? 'commands.inputUnsupported' : undefined
}

/** The variables the invocation refers to without a value on this device */
const invocationMissingVariables = (
  invocation: Pick<Invocation, 'toolId' | 'toolConfig'>,
  environment: CommandEnvironment
): string[] => commandMissingVariables(invocation, environment.variables)

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
          ? tool.getUnavailableReasonKey?.()
          : 'commands.toolMissing'
        : invocationUnavailableReason(invocation, deps.tools)
    if (reason === 'commands.variablesNotSet') {
      // the user is told which values to set here
      const names = invocationMissingVariables(
        invocation,
        deps.tools.environment!()
      )
      return {
        ok: false,
        messageKey: 'toast.variablesNotSet',
        message: names.join(', '),
        failure: `${reason}: ${names.join(', ')}`,
        unavailable: reason,
      }
    }
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
              isLlmArgumentParsingEnabled:
                invocation.isLlmArgumentParsingEnabled ?? false,
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
        editorSnapshot: options.editorSnapshot,
        source: options.source ?? 'menu',
        signal,
        ...(invocation.commandId
          ? {
              command: toolCallCommand(
                invocation.commandId,
                invocation.label,
                invocation.isOutputLogged ?? false
              ),
            }
          : {}),
        ...outputRequest(resolveSink(invocation, options) !== 'none'),
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        ...(options.context ? { context: options.context } : {}),
      })
      if (signal.aborted) {
        const settled = cancelledToolResult(result)
        return settled.cancelled ? settled : { ...settled, sourceText: '' }
      }
      return {
        ...result,
        sourceText: Object.keys(parsed.input).length ? text : '',
      }
    } catch (error) {
      if (signal.aborted || isPluginCancellation(error))
        return { ok: false, cancelled: true }
      if (isPluginError(error))
        return {
          ok: false,
          messageKey: error.messageKey,
          failure: error.messageKey,
        }
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
