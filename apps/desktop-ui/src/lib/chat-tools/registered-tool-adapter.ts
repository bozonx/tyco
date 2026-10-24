import type { RegisteredTool, ToolResult } from '../tools/tool-types'
import type { ChatToolDefinition } from './chat-tool-registry'

import { chatToolName } from './tool-name'

export { chatToolName } from './tool-name'

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
export async function adaptRegisteredTool(
  tool: RegisteredTool,
  options: RegisteredToolAdapterOptions
): Promise<ChatToolDefinition> {
  return {
    name: await chatToolName(tool.id),
    groupId: options.groupId,
    ...(tool.labelKey ? { labelKey: tool.labelKey } : {}),
    ...(tool.label ? { label: tool.label } : {}),
    ...(tool.icon ? { icon: tool.icon } : {}),
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
        isOutputRequested: true,
      })
      return toolResultForModel(result)
    },
  }
}
