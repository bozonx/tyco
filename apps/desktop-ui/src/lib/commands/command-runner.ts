import type { CommandConfig } from '@tyco/shared'

import {
  createInvocationRunner,
  type InvocationRunnerDependencies,
} from '../invocation/invocation-runner'
import type {
  InvocationOptions,
  InvocationOutcome,
} from '../invocation/invocation-types'
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

/** Runs the commands of the library; a disabled command does not run */
export function createCommandRunner(deps: CommandRunnerDependencies) {
  const runner = createInvocationRunner(deps)

  const preTransform = async (
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
      const messageKey =
        pre.messageKey ?? (pre.message ? undefined : FAILED_KEY)
      if (messageKey) {
        if (deps.showError) deps.showError(messageKey, pre.message)
        else deps.showToast(messageKey, 'error')
      } else if (pre.message && deps.showText) {
        deps.showText(pre.message, 'error')
      } else if (deps.showError) {
        deps.showError(FAILED_KEY, pre.message)
      } else {
        deps.showToast(FAILED_KEY, 'error')
      }
      const outcome: InvocationOutcome = {
        success: false,
        message: pre.message ?? messageKey ?? 'Pre-transformation failed',
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
    if (!pre.ok) return pre.outcome
    return runner.run(commandInvocation(command), pre.text, pre.options)
  }

  /** The output of `command` on `text`, which replaces the selection */
  const transform = async (
    command: CommandConfig,
    text: string,
    options: InvocationOptions = {}
  ): Promise<ToolResult> => {
    if (!command.isEnabled) return disabled
    if (!command.isLlmPreTransformEnabled) {
      return runner.transform(commandInvocation(command), text, options)
    }
    const pre = await preTransform(command, text, options)
    if (!pre.ok) return pre.result
    return runner.transform(commandInvocation(command), pre.text, pre.options)
  }

  return { run, transform }
}
