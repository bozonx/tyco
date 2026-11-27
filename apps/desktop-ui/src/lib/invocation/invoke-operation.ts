import { canOperationRunQuietly } from '../operations/quiet-operation'
import {
  cancelledOperationResult,
  isPluginError,
  isPluginCancellation,
} from '@tyco/plugin-sdk'
import { errorMessage } from '@tyco/shared/value-guards'
import {
  resolveOperationInput,
  operationCallConfig,
  operationInputKind,
  validateOperationInput,
} from '../operations/operation-input'
import { commandInputSchema } from '../operations/command-parameters'
import type {
  OperationLookup,
  OperationResult,
} from '../operations/operation-types'
import type { Invocation, InvocationOptions } from './invocation-types'
import { resolveSink } from './result-sinks'
import {
  outputRequest,
  operationCallCommand,
} from '../operations/operation-call'
import {
  commandMissingVariables,
  isOnPlatform,
  type CommandEnvironment,
} from '../variables/command-variables'

export interface OperationInvokerDependencies {
  /** The tools the invocations run */
  operations: OperationLookup
  /** The dictation language, for tools that parse the text */
  language?: () => string | undefined
}

/** A tool result, or why the tool was not called */
export type InvokeResult = OperationResult & {
  /** Why the call failed, for the log */
  failure?: string
  /** The text the tool got, the source of its output */
  sourceText?: string
  /** Why the tool could not be called, as an i18n key */
  unavailable?: string
}

/**
 * Why the invocation cannot run now, as an i18n key: no such tool, the tool is
 * not available, or it cannot get its input from a text. A caller that gives
 * the input whole (`hasExplicitInput`: an agent, a chat, an external call)
 * needs no text, so only the last check is skipped for it
 */
export function invocationUnavailableReason(
  invocation: Pick<
    Invocation,
    | 'operationId'
    | 'operationConfig'
    | 'isLlmArgumentParsingEnabled'
    | 'platforms'
  >,
  operations: OperationLookup,
  options: { hasExplicitInput?: boolean } = {}
): string | undefined {
  const tool = operations.get(invocation.operationId)
  if (!tool) return 'commands.typeMissing'
  const reason = tool.getUnavailableReasonKey?.()
  if (reason) return reason
  const environment = operations.environment?.()
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
      operationCallConfig(tool, invocation.operationConfig)[notesField] ?? ''
    ).trim()
  )
    return 'commands.notesFolderMissing'
  if (options.hasExplicitInput) return undefined
  const kind = operationInputKind(
    tool,
    invocation.operationConfig,
    invocation.isLlmArgumentParsingEnabled ?? false
  )
  return kind === null ? 'commands.inputUnsupported' : undefined
}

/** The variables the invocation refers to without a value on this device */
const invocationMissingVariables = (
  invocation: Pick<Invocation, 'operationId' | 'operationConfig'>,
  environment: CommandEnvironment
): string[] => commandMissingVariables(invocation, environment.variables)

/**
 * Calls the tool of an invocation: checks that it can run, turns the text into
 * its input and runs it. Reports nothing; `failure` tells the log why a call
 * failed
 */
export function createOperationInvoker(deps: OperationInvokerDependencies) {
  return async (
    invocation: Invocation,
    text: string,
    options: InvocationOptions = {}
  ): Promise<InvokeResult> => {
    const tool = deps.operations.get(invocation.operationId)
    // an explicit input needs no text, but the platform, the variables and
    // the folder of the tool are checked all the same
    const reason = invocationUnavailableReason(invocation, deps.operations, {
      hasExplicitInput: options.input !== undefined,
    })
    if (reason === 'commands.variablesNotSet') {
      // the user is told which values to set here
      const names = invocationMissingVariables(
        invocation,
        deps.operations.environment!()
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
      const unavailable = reason ?? 'commands.typeMissing'
      return {
        ok: false,
        messageKey: 'toast.commandUnavailable',
        message: invocation.label,
        failure: unavailable,
        unavailable,
      }
    }
    if (options.isQuiet && !canOperationRunQuietly(tool)) {
      return {
        ok: false,
        code: 'QuietRunUnsupported',
        message: 'This operation does not support quiet runs',
      }
    }
    const signal = options.signal ?? new AbortController().signal
    if (signal.aborted) return { ok: false, cancelled: true }

    const config = operationCallConfig(tool, invocation.operationConfig)
    try {
      const inputErrors =
        options.input === undefined
          ? []
          : // the open parameters of the command are part of its input
            validateOperationInput(
              commandInputSchema(tool, invocation.operationConfig),
              options.input
            )
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
          : await resolveOperationInput({
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
              command: operationCallCommand(
                invocation.commandId,
                invocation.label,
                invocation.isOutputLogged ?? false
              ),
            }
          : {}),
        ...outputRequest(resolveSink(invocation, options) !== 'none'),
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        ...(options.context ? { context: options.context } : {}),
        ...(options.isQuiet ? { isQuiet: true } : {}),
        ...(options.callerCommandIds
          ? { callerCommandIds: options.callerCommandIds }
          : {}),
      })
      if (signal.aborted) {
        const settled = cancelledOperationResult(result)
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
