import type { CommandConfig } from '@tyco/shared'
import type { JsonSchema, ToolCallCommand } from '@tyco/plugin-sdk'
import { toolCallConfig, toolInputSchema } from '../tools/tool-input'
import { toolCallCommand } from '../tools/tool-call'
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
  /** The command a tool is called for */
  command?: ToolCallCommand
  /**
   * Explicit tool name accepted by model providers; derived from tool ID when
   * absent
   */
  name?: string
  /** The human-readable label shown in UI */
  label?: string
  /** The description for the LLM */
  description?: string
  /** JSON Schema of the input */
  inputSchema?: JsonSchema
  /** Execution timeout in seconds */
  timeoutSec?: number
}

/**
 * A tool of the registry as the chat offers it: its LLM description and JSON
 * Schema, called the way a command calls it
 */
export async function adaptRegisteredTool(
  tool: RegisteredTool,
  options: RegisteredToolAdapterOptions
): Promise<ChatToolDefinition> {
  const name = options.name ?? (await chatToolName(tool.id))
  return {
    name,
    groupId: options.groupId,
    ...(tool.labelKey ? { labelKey: tool.labelKey } : {}),
    ...(options.label
      ? { label: options.label }
      : tool.label
        ? { label: tool.label }
        : {}),
    ...(tool.icon ? { icon: tool.icon } : {}),
    description: options.description ?? tool.description,
    inputSchema: options.inputSchema ?? tool.inputSchema,
    async execute(input, { signal }) {
      if (!options.timeoutSec || options.timeoutSec <= 0) {
        const result = await tool.run({
          input:
            input && typeof input === 'object' && !Array.isArray(input)
              ? (input as Record<string, unknown>)
              : {},
          config: { ...tool.baseConfig?.(), ...options.config },
          ...(options.command ? { command: options.command } : {}),
          source: 'chat',
          signal,
          isOutputRequested: true,
        })
        return toolResultForModel(result)
      }

      const controller = new AbortController()
      let timedOut = false

      const abortHandler = () => {
        controller.abort(signal.reason)
      }
      if (signal.aborted) {
        abortHandler()
      } else {
        signal.addEventListener('abort', abortHandler, { once: true })
      }

      const timeoutTimer = setTimeout(() => {
        timedOut = true
        controller.abort(
          new Error(`The tool call timed out after ${options.timeoutSec}s`)
        )
      }, options.timeoutSec * 1000)

      try {
        const result = await tool.run({
          input:
            input && typeof input === 'object' && !Array.isArray(input)
              ? (input as Record<string, unknown>)
              : {},
          config: { ...tool.baseConfig?.(), ...options.config },
          ...(options.command ? { command: options.command } : {}),
          source: 'chat',
          signal: controller.signal,
          isOutputRequested: true,
        })
        return toolResultForModel(result)
      } catch (error) {
        if (timedOut) {
          throw new Error(
            `The tool call timed out after ${options.timeoutSec}s`,
            { cause: error }
          )
        }
        throw error
      } finally {
        clearTimeout(timeoutTimer)
        signal.removeEventListener('abort', abortHandler)
      }
    },
  }
}

/**
 * Adapts a user command to a chat tool definition, resolving its config,
 * schema, label, timeout and command metadata.
 */
export async function adaptCommand(
  command: CommandConfig,
  tool: RegisteredTool,
  options: { groupId: string }
): Promise<ChatToolDefinition> {
  const config = toolCallConfig(tool, command.toolConfig)
  const inputSchema = toolInputSchema(tool, config)
  return adaptRegisteredTool(tool, {
    groupId: options.groupId,
    name: await chatToolName(command.id),
    label: command.name,
    description: command.description.trim(),
    inputSchema,
    config,
    command: toolCallCommand(command.id, command.name, command.isOutputLogged),
    timeoutSec: command.externalTimeoutSec,
  })
}
