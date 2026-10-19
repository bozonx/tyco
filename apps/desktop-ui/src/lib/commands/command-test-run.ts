import {
  type CommandConfig,
  SCRIPT_CANCELLED_ERROR,
  type ScriptActionRequest,
  type ScriptExecutionResult,
} from '@tyco/shared'

import {
  buildScriptRequest,
  cancelScriptRun,
} from '../custom-actions/script-executor'
import type { ToolLookup } from '../tools/tool-types'
import { commandLabel, commandTakesText, commandTool } from './command-runtime'
import { scriptToolConfig } from './command-config'

export interface CommandTestDependencies {
  executeScriptAction: (
    request: ScriptActionRequest
  ) => Promise<ScriptExecutionResult>
  /** False when no such run is going */
  cancelScriptAction?: (runId: string) => Promise<boolean>
  newRunId: () => string
  /**
   * Saves the settings draft and gives the command `commandId` as it is saved:
   * the backend runs saved scripts only
   */
  saveCommand: (commandId: string) => Promise<CommandConfig | undefined>
}

/** Whether the saved script runs the same as the one in the editor */
const isSameScript = (saved: CommandConfig, draft: CommandConfig): boolean => {
  const [a, b] = [scriptToolConfig(saved), scriptToolConfig(draft)]
  return (
    saved.toolId === 'script' &&
    a.command === b.command &&
    (a.workingDirectory ?? '') === (b.workingDirectory ?? '') &&
    a.timeoutSec === b.timeoutSec
  )
}

/**
 * How a test run from the command editor went: what a script printed and its
 * exit code, the output of another tool, or why it did not run
 */
export type CommandTestResult =
  | { kind: 'script'; result: ScriptExecutionResult }
  | { kind: 'output'; output: string }
  | { kind: 'error'; messageKey?: string; message?: string }
  | { kind: 'cancelled' }

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** The commands the editor can test: a script or a webhook */
export const canTestCommand = (command: CommandConfig): boolean =>
  command.toolId === 'script' || command.toolId === 'webhook'

/**
 * Runs `command` on `text` as it is configured, but keeps the output: nothing
 * replaces a selection, opens a menu or goes to the log. A script is saved
 * first and always waited for, so its exit code and stderr can be shown
 */
export async function runCommandTest(
  command: CommandConfig,
  text: string,
  tools: ToolLookup,
  deps: CommandTestDependencies,
  signal: AbortSignal
): Promise<CommandTestResult> {
  const input = commandTakesText(command, tools) ? text : null
  if (command.toolId === 'script') {
    const config = scriptToolConfig(command)
    if (!config.command.trim()) {
      return { kind: 'error', messageKey: 'commands.errorNoCommand' }
    }
    const saved = await deps.saveCommand(command.id)
    if (signal.aborted) return { kind: 'cancelled' }
    if (!saved || !isSameScript(saved, command)) {
      return { kind: 'error', messageKey: 'commands.testNeedsSave' }
    }
    const runId = deps.newRunId()
    let over = false
    const cancel = () => {
      cancelScriptRun(deps.cancelScriptAction, runId, () => over)
    }
    signal.addEventListener('abort', cancel, { once: true })
    try {
      const result = await deps.executeScriptAction({
        ...buildScriptRequest(command.id, input, {
          captureOutput: true,
          logOutput: false,
        }),
        runId,
      })
      return signal.aborted ? { kind: 'cancelled' } : { kind: 'script', result }
    } catch (error) {
      const message = errorMessage(error)
      if (signal.aborted || message === SCRIPT_CANCELLED_ERROR) {
        return { kind: 'cancelled' }
      }
      return { kind: 'error', message }
    } finally {
      over = true
      signal.removeEventListener('abort', cancel)
    }
  }

  const tool = commandTool(command, tools)
  if (!tool) return { kind: 'error', messageKey: 'commands.toolMissing' }
  try {
    const result = await tool.run({
      input: input === null ? {} : { text: input },
      config: command.toolConfig,
      source: 'menu',
      signal,
      command: {
        id: command.id,
        name: commandLabel(command),
        logOutput: false,
      },
      wantsOutput: true,
    })
    if (signal.aborted || result.cancelled) return { kind: 'cancelled' }
    if (!result.ok) {
      return {
        kind: 'error',
        messageKey: result.messageKey,
        message: result.message,
      }
    }
    return { kind: 'output', output: result.content ?? '' }
  } catch (error) {
    if (signal.aborted) return { kind: 'cancelled' }
    return { kind: 'error', message: errorMessage(error) }
  }
}
