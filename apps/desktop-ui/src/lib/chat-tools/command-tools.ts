import { COMMANDS_TOOL_GROUP_ID, type CommandConfig } from '@tyco/shared'

import { invocationUnavailableReason } from '../invocation/invoke-tool'
import type { ToolLookup } from '../tools/tool-types'
import {
  isOnPlatform,
  type CommandEnvironment,
} from '../variables/command-variables'
import type {
  ChatToolContext,
  ChatToolDefinition,
  ChatToolProvider,
} from './chat-tool-registry'
import { adaptCommand } from './registered-tool-adapter'

export { COMMANDS_TOOL_GROUP_ID }

export interface CommandToolProviderDependencies {
  /** All user commands configured in the app */
  commands: () => readonly CommandConfig[]
  /** Tool registry to look up tools by command.toolId */
  tools: ToolLookup
  /** The platform and the variable values of this device */
  environment?: () => CommandEnvironment
  /** Optional logger for skipped or problematic tools */
  warn?: (message: string) => void
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
      const group = context.settings?.groups[COMMANDS_TOOL_GROUP_ID]
      if (!group?.isEnabled || group.access === 'deny') return []

      const allowedIds = new Set(group.commandIds ?? [])
      if (allowedIds.size === 0) return []

      const allCommands = deps.commands()
      const env = deps.environment?.()
      const definitions: ChatToolDefinition[] = []

      for (const command of allCommands) {
        if (!allowedIds.has(command.id)) continue
        if (!command.isEnabled) continue

        const description = command.description?.trim()
        // A command cannot be offered to the model without an LLM description.
        if (!description) continue

        if (env && !isOnPlatform(command.platforms, env.platform)) continue

        const tool = deps.tools.get(command.toolId)
        if (!tool) {
          deps.warn?.(
            `Tool "${command.toolId}" for command "${command.name}" not found`
          )
          continue
        }

        // Tools that cannot run from chat (e.g. editor paste/copy) are omitted.
        if (tool.canRunFromChat === false) continue
        if (tool.getUnavailableReasonKey?.()) continue
        if (env && invocationUnavailableReason(command, deps.tools)) continue

        const chatTool = await adaptCommand(command, tool, {
          groupId: COMMANDS_TOOL_GROUP_ID,
        })
        definitions.push(chatTool)
      }

      return definitions
    },
  }
}
