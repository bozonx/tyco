import {
  MAX_TOOL_STEPS,
  TOOL_SOURCE_KINDS,
  type AiCommandOperationConfig,
  type CommandConfig,
  type CoreOperationId,
  type ToolRef,
  type ToolSourceKind,
} from '@tyco/shared'
import { isRecord } from '@tyco/shared/value-guards'

import {
  isSameToolRef,
  type CommandRiskLookup,
} from '../chat-tools/tool-catalog'
import { stringOr } from '../commands/command-config'

/** The tool of AI commands */
export const AI_COMMAND_OPERATION_ID = 'core.aiTask' satisfies CoreOperationId

export const isAiCommand = (command: Pick<CommandConfig, 'operationId'>) =>
  command.operationId === AI_COMMAND_OPERATION_ID

/**
 * The command's own step limit as a whole number within range; undefined when
 * it has none and takes `llm.maxToolSteps`
 */
export function maxStepsOf(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const steps = Math.round(value)
  return steps >= 1 ? Math.min(steps, MAX_TOOL_STEPS) : undefined
}

/** A whitelist entry as stored, or undefined for one that is not */
function toolRefOf(value: unknown): ToolRef | undefined {
  if (!isRecord(value)) return undefined
  const { sourceKind, sourceId, toolName } = value
  if (
    typeof sourceKind !== 'string' ||
    !(TOOL_SOURCE_KINDS as readonly string[]).includes(sourceKind) ||
    typeof sourceId !== 'string' ||
    !sourceId.trim()
  )
    return undefined
  if (toolName !== undefined && (typeof toolName !== 'string' || !toolName))
    return undefined
  return {
    sourceKind: sourceKind as ToolSourceKind,
    sourceId,
    ...(toolName === undefined ? {} : { toolName }),
  }
}

/** The settings of an AI command as read from its `operationConfig` */
export function aiCommandOperationConfigOf(
  config: Record<string, unknown>
): AiCommandOperationConfig {
  const tools: ToolRef[] = []
  for (const value of Array.isArray(config.tools) ? config.tools : []) {
    const ref = toolRefOf(value)
    if (ref && !tools.some((item) => isSameToolRef(item, ref))) tools.push(ref)
  }
  const maxSteps = maxStepsOf(config.maxSteps)
  return {
    prompt: stringOr(config.prompt),
    tools,
    ...(maxSteps === undefined ? {} : { maxSteps }),
  }
}

/** The ids of the commands on an AI command's whitelist */
export const whitelistedCommandIds = (tools: readonly ToolRef[]) =>
  tools.flatMap((ref) =>
    ref.sourceKind === 'commands' && ref.toolName ? [ref.toolName] : []
  )

/** How the risk of a command is looked up among `commands` */
export const commandRiskLookup = (
  commands: readonly CommandConfig[]
): CommandRiskLookup => ({
  commands,
  whitelistOf: (command) =>
    isAiCommand(command)
      ? aiCommandOperationConfigOf(command.operationConfig).tools
      : undefined,
})

/** The commands an AI command may let its agent run: any but itself */
export const callableCommands = (
  command: Pick<CommandConfig, 'id'>,
  commands: readonly CommandConfig[]
): CommandConfig[] => commands.filter((item) => item.id !== command.id)
