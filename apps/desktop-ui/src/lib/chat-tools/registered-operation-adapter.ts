import type { CommandConfig, ToolRisk } from '@tyco/shared'
import type { JsonSchema, OperationCallCommand } from '@tyco/plugin-sdk'
import { commandLabel } from '../commands/command-runtime'
import { commandInputSchema } from '../operations/command-parameters'
import { operationCallConfig } from '../operations/operation-input'
import { operationCallCommand } from '../operations/operation-call'
import type {
  RegisteredOperation,
  OperationResult,
} from '../operations/operation-types'
import type { ChatToolDefinition } from './chat-tool-registry'

import { chatToolName } from './tool-name'

import { COMMANDS_SOURCE, type ToolSourceRef } from './tool-catalog'

export { chatToolName } from './tool-name'

/**
 * What the model gets back from a tool's result: its text, or a short
 * confirmation. A failure is thrown, so the model sees the call as failed
 */
export function toolResultForModel(result: OperationResult): string {
  if (result.cancelled) throw new Error('The tool call was cancelled')
  const message = result.message?.trim() || result.messageKey
  if (!result.ok) throw new Error(message || 'The tool call failed')
  return result.content ?? message ?? 'Done'
}

export interface RegisteredOperationAdapterOptions {
  /** Where the tool comes from, and what it may do */
  source: ToolSourceRef
  risk: ToolRisk
  /** The tool's name in the settings; the model's name when absent */
  catalogName?: string
  /** The tool's `operationConfig` for the call, e.g. a command's own settings */
  config?: Record<string, unknown>
  /** The command a tool is called for */
  command?: OperationCallCommand
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
export async function adaptRegisteredOperation(
  tool: RegisteredOperation,
  options: RegisteredOperationAdapterOptions
): Promise<ChatToolDefinition> {
  const name = options.name ?? (await chatToolName(tool.id))
  return {
    name,
    source: options.source,
    risk: options.risk,
    ...(options.catalogName ? { catalogName: options.catalogName } : {}),
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
 * schema, label and command metadata. `run` executes the command the way the
 * other callers do (input checks, pre-transformation); without it the tool is
 * called directly. There is no time limit here: `run` bounds the command with
 * `commandRunTimeoutSec`, see `runWithinCommandLimit`
 */
export async function adaptCommand(
  command: CommandConfig,
  tool: RegisteredOperation,
  options: {
    /** What the command may do, see `commandRisk` */
    risk: ToolRisk
    run?: (
      input: Record<string, unknown>,
      signal: AbortSignal
    ) => Promise<OperationResult>
  }
): Promise<ChatToolDefinition> {
  const config = operationCallConfig(tool, command.operationConfig)
  const inputSchema = commandInputSchema(tool, command.operationConfig)
  const label = commandLabel(command)
  const definition = await adaptRegisteredOperation(tool, {
    source: COMMANDS_SOURCE,
    risk: options.risk,
    catalogName: command.id,
    name: await chatToolName(command.id),
    label,
    description: command.description.trim(),
    inputSchema,
    config,
    command: operationCallCommand(command.id, label, command.isOutputLogged),
  })
  const withSource = { ...definition, sourceLabel: label }
  const run = options.run
  if (!run) return withSource
  return {
    ...withSource,
    execute: async (input, { signal }) =>
      toolResultForModel(
        await run(
          input && typeof input === 'object' && !Array.isArray(input)
            ? (input as Record<string, unknown>)
            : {},
          signal
        )
      ),
  }
}
