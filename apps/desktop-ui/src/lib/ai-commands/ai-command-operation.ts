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
  type OperationDefinition,
  type OperationResult,
} from '../operations/operation-types'
import type { ToolCatalogSettings } from '@tyco/shared'

import type { ChatToolProvider } from '../chat-tools/chat-tool-registry'
import {
  AI_COMMAND_OPERATION_ID,
  aiCommandOperationConfigOf,
  whitelistedCommandIds,
} from './ai-command-config'
import {
  createAiCommandRunner,
  QuietRunConfirmationError,
  type AiCommandAgentTool,
  type AiCommandRunnerDependencies,
} from './ai-command-runner'

export interface AiCommandOperationDependencies extends AiCommandRunnerDependencies {
  /** The command library */
  commands: () => readonly CommandConfig[]
  /**
   * The input the agent gives the command, or undefined when the command cannot
   * run now
   */
  commandInputSchema: (
    command: CommandConfig,
    source: CommandRunSource
  ) => JsonSchema | undefined
  /** Runs a command for the agent on its input and reports nothing */
  runCommand: (
    command: CommandConfig,
    input: Record<string, unknown>,
    options: {
      signal: AbortSignal
      source: CommandRunSource
      /** The AI commands that led to the run, the running one last */
      callerCommandIds: readonly string[]
      isQuiet?: boolean
    }
  ) => Promise<OperationResult>
  /** Why the agent cannot run, as an i18n key */
  getUnavailableReasonKey: () => string | undefined
  /** A message for a failure of the LLM */
  describeError: (error: unknown) => string
  /** The values of the variables on this device, for `{{var:NAME}}` */
  variables?: () => VariableValues
  /** The tool sources besides commands a whitelist may name: web, plugins */
  toolProviders?: () => readonly ChatToolProvider[]
  /** The sources switched off everywhere */
  toolCatalog?: () => ToolCatalogSettings | undefined
}

/** A toast shows the start of a long answer of a command without output */
const NOTICE_MAX_CHARS = 280

const notice = (content: string): string => {
  const text = content.trim()
  return text.length > NOTICE_MAX_CHARS
    ? `${text.slice(0, NOTICE_MAX_CHARS).trimEnd()}…`
    : text
}

const cancelled: OperationResult = { ok: false, cancelled: true }

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
export function createAiCommandOperation(
  deps: AiCommandOperationDependencies
): OperationDefinition {
  const run = createAiCommandRunner(deps)

  const agentTools = (
    allowedCommandIds: readonly string[],
    chain: readonly string[],
    runSignal: AbortSignal,
    source: CommandRunSource,
    isQuiet?: boolean
  ): AiCommandAgentTool[] => {
    if (chain.length >= AI_COMMAND_MAX_DEPTH) return []
    const commands = deps.commands()
    return allowedCommandIds.flatMap((id) => {
      if (chain.includes(id)) return []
      const command = commands.find((item) => item.id === id)
      if (!command?.isEnabled) return []
      const inputSchema = deps.commandInputSchema(command, source)
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
            const current = deps.commands().find((item) => item.id === id)
            if (
              !current?.isEnabled ||
              JSON.stringify(current) !== JSON.stringify(command)
            )
              throw new Error('The command changed during this turn')
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
                ...(isQuiet ? { isQuiet } : {}),
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
    id: AI_COMMAND_OPERATION_ID,
    voiceSelectionRole: 'attach',
    labelKey: 'operations.aiTask',
    descriptionKey: 'operations.aiTaskDescription',
    icon: 'mdi:robot-outline',
    description:
      'Follows the instructions of the command with an LLM agent that may run the commands it is allowed to',
    defaultOutputAction: 'insertIntoWindow',
    inputSchema: { ...TEXT_INPUT_SCHEMA, required: [] },
    getUnavailableReasonKey: deps.getUnavailableReasonKey,
    run: async (call) => {
      const text = typeof call.input.text === 'string' ? call.input.text : ''
      const saved = aiCommandOperationConfigOf(call.config)
      if (!saved.prompt.trim())
        return { ok: false, messageKey: 'commands.errorNoPrompt' }
      const prompt = substituteVariables(
        saved.prompt,
        deps.variables?.() ?? {},
        'text'
      )
      if (!prompt.ok && 'cycles' in prompt)
        return {
          ok: false,
          message: `Cyclic variable references: ${prompt.cycles.join(', ')}`,
        }
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
        const tools = agentTools(
          whitelistedCommandIds(config.tools),
          chain,
          call.signal,
          call.source,
          call.isQuiet
        )
        const content = await run(config, text, tools, {
          signal: call.signal,
          isQuiet: call.isQuiet,
          ...(call.command ? { commandId: call.command.id } : {}),
          providers: deps.toolProviders?.() ?? [],
          catalog: deps.toolCatalog?.(),
          ...(call.command && {
            getCurrentScope: () => {
              const commandId = call.command!.id
              const current = deps
                .commands()
                .find((command) => command.id === commandId)
              return {
                kind: 'aiCommand',
                commandId,
                tools:
                  current?.isEnabled &&
                  current.operationId === AI_COMMAND_OPERATION_ID
                    ? aiCommandOperationConfigOf(current.operationConfig).tools
                    : [],
                catalog: deps.toolCatalog?.(),
              }
            },
          }),
          ...(call.onProgress ? { onStep: call.onProgress } : {}),
        })
        if (call.signal.aborted) return cancelled
        if (!content.trim())
          return { ok: false, messageKey: 'selection.emptyResult' }
        // the message is what a command without output shows of the answer
        return { ok: true, content, message: notice(content) }
      } catch (error) {
        if (call.signal.aborted) return cancelled
        if (error instanceof QuietRunConfirmationError)
          return {
            ok: false,
            code: 'ConfirmationRequired',
            message: error.message,
          }
        return { ok: false, message: deps.describeError(error) }
      }
    },
  }
}
