import type { CommandConfig } from '@tyco/shared'

import { commandRiskLookup } from '../ai-commands/ai-command-config'
import { createCommandTransformer } from '../commands/command-runner'
import { runWithinCommandLimit } from '../commands/command-run-limit'
import { invocationUnavailableReason } from '../invocation/invoke-operation'
import type { OperationLookup } from '../operations/operation-types'
import {
  isOnPlatform,
  type CommandEnvironment,
} from '../variables/command-variables'
import type {
  ChatToolContext,
  ChatToolDefinition,
  ChatToolProvider,
} from './chat-tool-registry'
import { adaptCommand } from './registered-operation-adapter'
import { commandRisk } from './tool-catalog'

export interface CommandToolProviderDependencies {
  /** All user commands configured in the app */
  commands: () => readonly CommandConfig[]
  /** Tool registry to look up tools by command.operationId */
  operations: OperationLookup
  /** The platform and the variable values of this device */
  environment?: () => CommandEnvironment
  /** Optional logger for skipped or problematic tools */
  warn?: (message: string) => void
  /** `commandRunTimeoutSec`, the limit shared by all command runs */
  runLimitSec?: () => number | undefined
}

/**
 * Provides user commands (scripts, webhooks, plugin tools) as chat tools,
 * offering only those explicitly selected in the profile and equipped with a
 * description for the LLM.
 */
export function createCommandToolProvider(
  deps: CommandToolProviderDependencies
): ChatToolProvider {
  return {
    id: 'commands',
    async tools(context: ChatToolContext): Promise<ChatToolDefinition[]> {
      // the chat runs a command as an AI command does: the input is checked
      // and the command's pre-transformation applies
      const transform = createCommandTransformer({
        operations: deps.operations,
      })
      if (context.scope.kind !== 'profile') return []
      const allowedIds = new Set(context.scope.settings?.commandIds ?? [])
      if (allowedIds.size === 0) return []

      const allCommands = deps.commands()
      const riskLookup = commandRiskLookup(allCommands)
      const env = deps.environment?.()
      const definitions: ChatToolDefinition[] = []

      for (const command of allCommands) {
        if (!allowedIds.has(command.id)) continue
        if (!command.isEnabled) continue

        const description = command.description?.trim()
        // A command cannot be offered to the model without an LLM description.
        if (!description) continue

        if (env && !isOnPlatform(command.platforms, env.platform)) continue

        const tool = deps.operations.get(command.operationId)
        if (!tool) {
          deps.warn?.(
            `Tool "${command.operationId}" for command "${command.name}" not found`
          )
          continue
        }

        // Tools that cannot run from chat (e.g. editor paste/copy) are omitted.
        if (tool.canRunFromChat === false) continue
        if (tool.getUnavailableReasonKey?.()) continue
        // the model gives the input whole, so a structured one needs no parser
        if (
          env &&
          invocationUnavailableReason(command, deps.operations, {
            hasExplicitInput: true,
          })
        )
          continue

        const chatTool = await adaptCommand(command, tool, {
          risk: commandRisk(command, riskLookup),
          run: async (input, signal) => {
            const run = await runWithinCommandLimit(
              deps.runLimitSec?.(),
              signal,
              (limited) =>
                transform(
                  command,
                  typeof input.text === 'string' ? input.text : '',
                  { input, signal: limited, source: 'chat', output: 'return' }
                )
            )
            return run.isTimedOut
              ? {
                  ok: false,
                  message: `The command did not finish within ${run.seconds} s and was stopped`,
                }
              : run.value
          },
        })
        definitions.push(chatTool)
      }

      return definitions
    },
  }
}
