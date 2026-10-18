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
import { commandInvocation } from './command-runtime'

const disabled: ToolResult = {
  ok: false,
  level: 'warn',
  messageKey: 'toast.commandDisabled',
}

/** Runs the commands of the library; a disabled command does not run */
export function createCommandRunner(deps: InvocationRunnerDependencies) {
  const runner = createInvocationRunner(deps)

  const run = async (
    command: CommandConfig,
    text: string,
    options: InvocationOptions = {}
  ): Promise<InvocationOutcome> => {
    if (!command.isEnabled) {
      deps.showToast('toast.commandDisabled', 'warn')
      return { success: false, message: 'Disabled' }
    }
    return runner.run(commandInvocation(command), text, options)
  }

  /** The output of `command` on `text`, which replaces the selection */
  const transform = async (
    command: CommandConfig,
    text: string,
    options: InvocationOptions = {}
  ): Promise<ToolResult> =>
    command.isEnabled
      ? runner.transform(commandInvocation(command), text, options)
      : disabled

  return { run, transform }
}
