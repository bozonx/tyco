import {
  substituteVariables,
  type CommandConfig,
  type CommandRunSource,
  type VariableValues,
} from '@tyco/shared'

import { commandLabel } from '../commands/command-runtime'
import {
  TEXT_INPUT_SCHEMA,
  type JsonSchema,
  type ToolDefinition,
  type ToolResult,
} from '../tools/tool-types'
import { AI_COMMAND_TOOL_ID, aiCommandToolConfigOf } from './ai-command-config'
import {
  createAiCommandRunner,
  type AiCommandAgentTool,
  type AiCommandRunnerDependencies,
} from './ai-command-runner'

export interface AiCommandToolDependencies extends AiCommandRunnerDependencies {
  /** The command library */
  commands: () => readonly CommandConfig[]
  /**
   * The input the agent gives the command, or undefined when the command cannot
   * run now
   */
  commandInputSchema: (command: CommandConfig) => JsonSchema | undefined
  /** Runs a command for the agent on its input and reports nothing */
  runCommand: (
    command: CommandConfig,
    input: Record<string, unknown>,
    options: {
      signal: AbortSignal
      source: CommandRunSource
      /** The AI commands that led to the run, the running one last */
      callerCommandIds: readonly string[]
    }
  ) => Promise<ToolResult>
  /** Why the agent cannot run, as an i18n key */
  getUnavailableReasonKey: () => string | undefined
  /** A message for a failure of the LLM */
  describeError: (error: unknown) => string
  /** The values of the variables on this device, for `{{var:NAME}}` */
  variables?: () => VariableValues
}

/** A toast shows the start of a long answer of a command without output */
const NOTICE_MAX_CHARS = 280

const notice = (content: string): string => {
  const text = content.trim()
  return text.length > NOTICE_MAX_CHARS
    ? `${text.slice(0, NOTICE_MAX_CHARS).trimEnd()}…`
    : text
}

const cancelled: ToolResult = { ok: false, cancelled: true }

/**
 * How many AI commands may run one inside another: the innermost one runs no
 * commands, so a chain of agents cannot multiply the calls of the LLM without
 * end
 */
export const AI_COMMAND_MAX_DEPTH = 3

/**
 * The tool of AI commands: an LLM agent that follows the prompt of the command
 * and may run the commands the command allows. A command never runs itself, nor
 * a command that led to it, so AI commands cannot call each other in a loop;
 * nor do they nest deeper than `AI_COMMAND_MAX_DEPTH`. The command decides what
 * to do with the answer
 */
export function createAiCommandTool(
  deps: AiCommandToolDependencies
): ToolDefinition {
  const run = createAiCommandRunner(deps)

  const agentTools = (
    allowedCommandIds: readonly string[],
    chain: readonly string[],
    runSignal: AbortSignal,
    source: CommandRunSource
  ): AiCommandAgentTool[] => {
    if (chain.length >= AI_COMMAND_MAX_DEPTH) return []
    const commands = deps.commands()
    return allowedCommandIds.flatMap((id) => {
      if (chain.includes(id)) return []
      const command = commands.find((item) => item.id === id)
      if (!command?.isEnabled) return []
      const inputSchema = deps.commandInputSchema(command)
      if (!inputSchema) return []
      const label = commandLabel(command)
      const about = command.description.trim()
      return [
        {
          commandId: id,
          label,
          description: about ? `${label}: ${about}` : label,
          inputSchema,
          execute: async (input, signal) => {
            const controller = new AbortController()
            const abort = () => controller.abort()
            for (const parent of [signal, runSignal]) {
              if (parent.aborted) abort()
              else parent.addEventListener('abort', abort, { once: true })
            }
            try {
              return await deps.runCommand(command, input, {
                signal: controller.signal,
                source,
                callerCommandIds: chain,
              })
            } finally {
              signal.removeEventListener('abort', abort)
              runSignal.removeEventListener('abort', abort)
            }
          },
        },
      ]
    })
  }

  return {
    id: AI_COMMAND_TOOL_ID,
    labelKey: 'tools.aiTask',
    descriptionKey: 'tools.aiTaskDescription',
    icon: 'mdi:robot-outline',
    description:
      'Follows the instructions of the command with an LLM agent that may run the commands it is allowed to',
    defaultOutputAction: 'insertIntoWindow',
    inputSchema: { ...TEXT_INPUT_SCHEMA, required: [] },
    getUnavailableReasonKey: deps.getUnavailableReasonKey,
    run: async (call) => {
      const text = typeof call.input.text === 'string' ? call.input.text : ''
      const saved = aiCommandToolConfigOf(call.config)
      if (!saved.prompt.trim())
        return { ok: false, messageKey: 'commands.errorNoPrompt' }
      const prompt = substituteVariables(
        saved.prompt,
        deps.variables?.() ?? {},
        'text'
      )
      // an empty value is never put in quietly: the run says what is missing
      if (!prompt.ok)
        return {
          ok: false,
          messageKey: 'toast.variablesNotSet',
          message: prompt.missing.join(', '),
        }
      const config = { ...saved, prompt: prompt.value }
      const chain = [
        ...(call.callerCommandIds ?? []),
        ...(call.command ? [call.command.id] : []),
      ]
      try {
        const tools =
          config.isToolsEnabled !== false
            ? agentTools(
                config.allowedCommandIds,
                chain,
                call.signal,
                call.source
              )
            : []
        const content = await run(config, text, tools, {
          signal: call.signal,
          ...(call.onProgress ? { onStep: call.onProgress } : {}),
        })
        if (call.signal.aborted) return cancelled
        if (!content.trim())
          return { ok: false, messageKey: 'selection.emptyResult' }
        // the message is what a command without output shows of the answer
        return { ok: true, content, message: notice(content) }
      } catch (error) {
        if (call.signal.aborted) return cancelled
        return { ok: false, message: deps.describeError(error) }
      }
    },
  }
}
