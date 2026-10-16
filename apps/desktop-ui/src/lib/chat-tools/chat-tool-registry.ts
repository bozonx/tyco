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

import {
  MIN_TOOL_OUTPUT_CHARACTERS,
  normalizeToolOutput,
  TOOL_OUTPUT_CHARACTERS,
} from './chat-tool-output'
import { chatToolApprovalKey, type ChatToolPolicy } from './chat-tool-policy'

/** Names the AI providers accept for a tool */
const TOOL_NAME = /^[a-zA-Z0-9_-]{1,64}$/

export interface ChatToolExecuteOptions {
  signal: AbortSignal
  toolCallId: string
  /**
   * How much of the output the model is given: the tool's own limit, or less
   * when the turn's steps have used up most of the context. A tool that pages
   * its output fits a page into it
   */
  outputLimitCharacters: number
}

/** What the user is shown of a call before deciding on it */
export interface ChatToolPreview {
  kind: 'file-change'
  path: string
  /** Null for a file the call creates */
  before: string | null
  after: string
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
  /**
   * What "allow in this session" covers besides the tool, e.g. the project a
   * path is in. The whole tool when absent
   */
  approvalScope?(input: unknown): string | undefined
  /** Shown with the approval request; a failure only leaves it out */
  preview?(
    input: unknown,
    signal: AbortSignal
  ): Promise<ChatToolPreview | undefined>
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
  /**
   * How much the outputs of the turn's tools may add to the request in all;
   * unlimited when absent
   */
  outputBudgetCharacters?: number
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
  /**
   * What the model is told besides the tools' descriptions, e.g. the folders it
   * can reach. Asked after `tools`, with the same context, only when the
   * provider offered a tool
   */
  instructions?(context: ChatToolContext): string | undefined
}

/** The tools of one request, ready for the model */
export interface ChatToolSet {
  tools: ToolSet
  toolApproval: ToolApproval
  definitions: ReadonlyMap<string, ChatToolDefinition>
  /** The calls whose output was cut, so the chat can mark them */
  truncatedCallIds: ReadonlySet<string>
  /** What "allow in this session" of a call is remembered by */
  approvalKey(toolName: string, input: unknown): string
  /** Added to the system instructions; absent when no provider has any */
  instructions?: string
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
    const instructions: string[] = []
    for (const provider of deps.providers()) {
      let isOffered = false
      for (const tool of await provider.tools(context)) {
        const group = groupOf(context.settings, tool.groupId)
        if (!group?.isEnabled || group.access === 'deny') continue
        if (!TOOL_NAME.test(tool.name) || definitions.has(tool.name)) {
          deps.warn?.(`Chat tool "${tool.name}" of ${provider.id} is skipped`)
          continue
        }
        definitions.set(tool.name, tool)
        isOffered = true
      }
      const text = isOffered ? provider.instructions?.(context)?.trim() : ''
      if (text) instructions.push(text)
    }
    if (definitions.size === 0) return null

    const truncatedCallIds = new Set<string>()
    // what the outputs of the turn may still add; each call takes from it
    let remainingCharacters =
      context.outputBudgetCharacters ?? Number.POSITIVE_INFINITY
    const tools: ToolSet = {}
    for (const tool of definitions.values()) {
      tools[tool.name] = dynamicTool({
        description: tool.description,
        inputSchema: jsonSchema(
          tool.inputSchema as Parameters<typeof jsonSchema>[0]
        ),
        execute: async (input, { abortSignal, toolCallId }) => {
          const limitCharacters = Math.min(
            tool.outputLimitCharacters ?? TOOL_OUTPUT_CHARACTERS,
            Math.max(MIN_TOOL_OUTPUT_CHARACTERS, remainingCharacters)
          )
          const output = normalizeToolOutput(
            await tool.execute(input, {
              signal: abortSignal ?? new AbortController().signal,
              toolCallId,
              outputLimitCharacters: limitCharacters,
            }),
            limitCharacters
          )
          remainingCharacters = Math.max(
            0,
            remainingCharacters - output.text.length
          )
          if (output.isTruncated) truncatedCallIds.add(toolCallId)
          return output.text
        },
      })
    }

    const approvalKey = (toolName: string, input: unknown) =>
      chatToolApprovalKey(
        toolName,
        definitions.get(toolName)?.approvalScope?.(input)
      )

    const toolApproval: ToolApproval = ({ toolCall }) => {
      const tool = definitions.get(toolCall.toolName)
      if (!tool) return 'denied'
      const groupAccess =
        groupOf(context.settings, tool.groupId)?.access ?? 'deny'
      return deps.policy.decide(
        approvalKey(tool.name, toolCall.input),
        tool.accessFor?.(toolCall.input) ?? groupAccess
      )
    }

    return {
      tools,
      toolApproval,
      definitions,
      truncatedCallIds,
      approvalKey,
      ...(instructions.length
        ? { instructions: instructions.join('\n\n') }
        : {}),
    }
  }

  return { resolve }
}

export type ChatToolRegistry = ReturnType<typeof createChatToolRegistry>
