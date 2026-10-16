import {
  dynamicTool,
  jsonSchema,
  type ToolApproval,
  type ToolSet,
} from '@bozonx/ai-kit'
import type {
  ProfileToolSettings,
  ProjectAccessMode,
  ToolGroupSettings,
} from '@tyco/shared'
import type { JsonSchema } from '@tyco/plugin-sdk'

import { normalizeToolOutput, TOOL_OUTPUT_CHARACTERS } from './chat-tool-output'
import type { ChatToolPolicy } from './chat-tool-policy'

/** Names the AI providers accept for a tool */
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/

export interface ChatToolExecuteOptions {
  signal: AbortSignal
  toolCallId: string
}

/** One tool the model may call */
export interface ChatToolDefinition {
  /** Unique in a request; what the model calls the tool by */
  name: string
  /** The group whose settings decide whether it is offered and how freely */
  groupId: string
  /** The name the chat shows: an i18n key for a core tool */
  labelKey?: string
  /** The name the chat shows when it comes from a plugin or MCP server */
  label?: string
  /** An Iconify name shown next to the call */
  icon?: string
  /** Shown to the model, in English: what the tool does, when to use it */
  description: string
  inputSchema: JsonSchema
  /**
   * The access of one call, when it depends on the input — a path in a
   * read-only project, say. The group's access when absent or undefined
   */
  accessFor?(input: unknown): ProjectAccessMode | undefined
  /** How much of the output the model is given */
  outputLimitCharacters?: number
  /**
   * Runs the call. A thrown error is reported to the model as the call's
   * failure, which it can react to
   */
  execute(input: unknown, options: ChatToolExecuteOptions): Promise<unknown>
}

/** What a request offers tools for */
export interface ChatToolContext {
  /** Null for "Ask AI" */
  profileId: string | null
  modelId: string
  settings: ProfileToolSettings | undefined
}

/**
 * A source of tools: files, commands, MCP servers. Later phases add one each
 * without touching the registry
 */
export interface ChatToolProvider {
  id: string
  tools(
    context: ChatToolContext
  ): ChatToolDefinition[] | Promise<ChatToolDefinition[]>
}

/** The tools of one request, ready for the model */
export interface ChatToolSet {
  tools: ToolSet
  toolApproval: ToolApproval
  definitions: ReadonlyMap<string, ChatToolDefinition>
  /** The calls whose output was cut, so the chat can mark them */
  truncatedCallIds: ReadonlySet<string>
}

export interface ChatToolRegistryDependencies {
  providers: () => readonly ChatToolProvider[]
  policy: ChatToolPolicy
  /** Logs a tool a provider described wrongly; the rest still work */
  warn?: (message: string) => void
}

const groupOf = (
  settings: ProfileToolSettings | undefined,
  groupId: string
): ToolGroupSettings | undefined => settings?.groups[groupId]

export function createChatToolRegistry(deps: ChatToolRegistryDependencies) {
  /**
   * The tools the request may offer: those of enabled groups that are not
   * denied outright. Null when there are none, so that a chat without tools
   * sends exactly what it always did
   */
  async function resolve(
    context: ChatToolContext
  ): Promise<ChatToolSet | null> {
    const definitions = new Map<string, ChatToolDefinition>()
    for (const provider of deps.providers()) {
      for (const tool of await provider.tools(context)) {
        const group = groupOf(context.settings, tool.groupId)
        if (!group?.isEnabled || group.access === 'deny') continue
        if (!TOOL_NAME.test(tool.name) || definitions.has(tool.name)) {
          deps.warn?.(`Chat tool "${tool.name}" of ${provider.id} is skipped`)
          continue
        }
        definitions.set(tool.name, tool)
      }
    }
    if (definitions.size === 0) return null

    const truncatedCallIds = new Set<string>()
    const tools: ToolSet = {}
    for (const tool of definitions.values()) {
      tools[tool.name] = dynamicTool({
        description: tool.description,
        inputSchema: jsonSchema(
          tool.inputSchema as Parameters<typeof jsonSchema>[0]
        ),
        execute: async (input, { abortSignal, toolCallId }) => {
          const output = normalizeToolOutput(
            await tool.execute(input, {
              signal: abortSignal ?? new AbortController().signal,
              toolCallId,
            }),
            tool.outputLimitCharacters ?? TOOL_OUTPUT_CHARACTERS
          )
          if (output.isTruncated) truncatedCallIds.add(toolCallId)
          return output.text
        },
      })
    }

    const toolApproval: ToolApproval = ({ toolCall }) => {
      const tool = definitions.get(toolCall.toolName)
      if (!tool) return 'denied'
      const groupAccess =
        groupOf(context.settings, tool.groupId)?.access ?? 'deny'
      return deps.policy.decide(
        tool.name,
        tool.accessFor?.(toolCall.input) ?? groupAccess
      )
    }

    return { tools, toolApproval, definitions, truncatedCallIds }
  }

  return { resolve }
}

export type ChatToolRegistry = ReturnType<typeof createChatToolRegistry>
