import type { RegisteredTool, ToolResult } from '../tools/tool-types'
import type { ChatToolDefinition } from './chat-tool-registry'

/** Characters the providers do not accept in a tool name */
const UNSAFE_NAME_CHARACTERS = /[^a-zA-Z0-9_-]/g

/** The name a registry tool goes by for the model: `core.copy` → `core_copy` */
export function chatToolName(toolId: string): string {
  return toolId.replace(UNSAFE_NAME_CHARACTERS, '_').slice(0, 64)
}

/**
 * What the model gets back from a tool's result: its text, or a short
 * confirmation. A failure is thrown, so the model sees the call as failed
 */
export function toolResultForModel(result: ToolResult): string {
  if (result.cancelled) throw new Error('The tool call was cancelled')
  const message = result.message?.trim() || result.messageKey
  if (!result.ok) throw new Error(message || 'The tool call failed')
  return result.content ?? message ?? 'Done'
}

export interface RegisteredToolAdapterOptions {
  groupId: string
  /** The tool's `toolConfig` for the call, e.g. a command's own settings */
  config?: Record<string, unknown>
}

/**
 * A tool of the registry as the chat offers it: its LLM description and JSON
 * Schema, called the way a command calls it
 */
export function adaptRegisteredTool(
  tool: RegisteredTool,
  options: RegisteredToolAdapterOptions
): ChatToolDefinition {
  return {
    name: chatToolName(tool.id),
    groupId: options.groupId,
    description: tool.description,
    inputSchema: tool.inputSchema,
    async execute(input, { signal }) {
      const result = await tool.run({
        input:
          input && typeof input === 'object' && !Array.isArray(input)
            ? (input as Record<string, unknown>)
            : {},
        config: { ...tool.baseConfig?.(), ...options.config },
        source: 'chat',
        signal,
        wantsOutput: true,
      })
      return toolResultForModel(result)
    },
  }
}
