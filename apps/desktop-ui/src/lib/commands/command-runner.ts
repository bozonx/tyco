import type { CommandConfig } from '@tyco/shared'

import {
  createInvocationRunner,
  type InvocationRunnerDependencies,
  reportResult,
} from '../invocation/invocation-runner'
import type {
  InvocationOptions,
  InvocationOutcome,
} from '../invocation/invocation-types'
import { createToolInvoker } from '../invocation/invoke-tool'
import type { ToolResult } from '../tools/tool-types'
import { commandInvocation, preTransformCommandText } from './command-runtime'

/** Shown when a pre-transformation fails without saying why */
const FAILED_KEY = 'commands.preTransformFailed'

const disabled: ToolResult = {
  ok: false,
  level: 'warn',
  messageKey: 'toast.commandDisabled',
}

export interface CommandRunnerDependencies extends InvocationRunnerDependencies {
  transformTextWithLlm?: (
    prompt: string,
    text: string,
    options?: { signal?: AbortSignal }
  ) => Promise<string>
}

type CommandTransformDependencies = Pick<
  CommandRunnerDependencies,
  'tools' | 'language' | 'transformTextWithLlm'
>

function createInputPreparation(deps: CommandTransformDependencies) {
  return async (
    command: CommandConfig,
    text: string,
    options: InvocationOptions
  ) => {
    const pre = await preTransformCommandText(command, text, deps.tools, {
      signal: options.signal,
      source: options.source,
      transformTextWithLlm: deps.transformTextWithLlm,
    })
    if (pre.cancelled) {
      const outcome: InvocationOutcome = {
        success: false,
        cancelled: true,
        message: 'Cancelled',
      }
      const result: ToolResult = { ok: false, cancelled: true }
      return { ok: false as const, outcome, result }
    }
    if (!pre.ok) {
      // the LLM error alone would not say what failed
      const messageKey = pre.messageKey ?? FAILED_KEY
      const outcome: InvocationOutcome = {
        success: false,
        message: pre.message ?? messageKey,
      }
      const result: ToolResult = { ok: false, messageKey, message: pre.message }
      return { ok: false as const, outcome, result }
    }
    const nextText = pre.text ?? text
    const nextOptions =
      options.input && typeof options.input.text === 'string'
        ? { ...options, input: { ...options.input, text: nextText } }
        : options
    return { ok: true as const, text: nextText, options: nextOptions }
  }
}

/**
 * Executes a command without presenting its result, retaining input
 * preparation.
 */
export function createCommandTransformer(deps: CommandTransformDependencies) {
  const invoke = createToolInvoker(deps)
  const prepare = createInputPreparation(deps)
  return async (
    command: CommandConfig,
    text: string,
    options: InvocationOptions = {}
  ): Promise<ToolResult> => {
    if (!command.isEnabled) return disabled
    const pre = await prepare(command, text, options)
    if (!pre.ok) return pre.result
    const {
      unavailable,
      failure: _failure,
      sourceText: _source,
      ...result
    } = await invoke(commandInvocation(command), pre.text, {
      ...pre.options,
      output: 'return',
    })
    return unavailable ? { ok: false, messageKey: unavailable } : result
  }
}

/** Runs the commands of the library; a disabled command does not run */
export function createCommandRunner(deps: CommandRunnerDependencies) {
  const runner = createInvocationRunner(deps)
  const preTransform = createInputPreparation(deps)

  const run = async (
    command: CommandConfig,
    text: string,
    options: InvocationOptions = {}
  ): Promise<InvocationOutcome> => {
    if (!command.isEnabled) {
      deps.showToast('toast.commandDisabled', 'warn')
      return { success: false, message: 'Disabled' }
    }
    if (!command.isLlmPreTransformEnabled) {
      return runner.run(commandInvocation(command), text, options)
    }
    const pre = await preTransform(command, text, options)
    if (!pre.ok) {
      // `transform` leaves it to its caller, which reports it its own way
      if (!pre.result.cancelled) reportResult(deps, pre.result)
      return pre.outcome
    }
    return runner.run(commandInvocation(command), pre.text, pre.options)
  }

  const transform = createCommandTransformer(deps)

  return { run, transform }
}
