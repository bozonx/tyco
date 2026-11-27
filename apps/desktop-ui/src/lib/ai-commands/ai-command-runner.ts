import { isRecord } from '@tyco/shared/value-guards'
import type {
  AiCommandOperationConfig,
  ToolCatalogSettings,
} from '@tyco/shared'

import {
  runChatToolLoop,
  type ChatToolLoopState,
} from '../chat-tools/chat-tool-loop'
import { createChatToolPolicy } from '../chat-tools/chat-tool-policy'
import {
  createChatToolRegistry,
  type ChatToolDefinition,
  type ChatToolProvider,
} from '../chat-tools/chat-tool-registry'
import {
  COMMANDS_SOURCE,
  toolCallContextOf,
  type ToolScope,
} from '../chat-tools/tool-catalog'
import { toolResultForModel } from '../chat-tools/registered-operation-adapter'
import type {
  LlmRunName,
  LlmStreamEvent,
  LlmStreamOptions,
} from '../llm/llm-client'
import { cleanLlmOutput } from '../llm/llm-output'
import type { LlmPrompt } from '../llm/llm-prompt'
import type { JsonSchema, OperationResult } from '../operations/operation-types'

/** A command the agent may run, as a tool of the model */
export interface AiCommandAgentTool {
  commandId: string
  /** The name of the command the user knows it by */
  label: string
  /** What the model is told about the command */
  description: string
  inputSchema: JsonSchema
  execute: (
    input: Record<string, unknown>,
    signal: AbortSignal
  ) => Promise<OperationResult>
}

export interface AiCommandRunnerDependencies {
  stream: (
    task: LlmRunName,
    prompt: LlmPrompt,
    options?: LlmStreamOptions
  ) => AsyncIterable<LlmStreamEvent>
  /** The app's instructions for every AI command */
  instructions: () => string
  /** The call limit of a command without its own, see `llm.maxToolSteps` */
  defaultMaxSteps: () => number
}

export interface AiCommandRunOptions {
  isQuiet?: boolean
  signal: AbortSignal
  /** The AI command that runs, whose whitelist Rust checks its calls by */
  commandId?: string
  /**
   * The other sources of the whitelist: the web, plugins, MCP servers. Only the
   * tools on the whitelist are offered
   */
  providers?: readonly ChatToolProvider[]
  /** The sources switched off everywhere */
  catalog?: ToolCatalogSettings
  getCurrentScope?: () => ToolScope
  /** Tells which tool the agent runs now, by its name */
  onStep?: (label: string) => void
}

const TOOL_NAME_LENGTH = 64

/**
 * What a call over the limit gets in place of a result: parallel calls of one
 * step may exceed it, and the model must not take this for the output of the
 * command
 */
export const CALL_LIMIT_NOTICE =
  'NOT RUN: the command call limit is reached, so this command did not run and produced no output. Do not call more commands; answer using the results already available.'

/**
 * A name the AI providers accept for the tool of a command: the index keeps
 * apart ids that differ only in characters a name cannot have
 */
const agentToolName = (index: number, commandId: string): string =>
  `c${index}_${commandId.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(
    0,
    TOOL_NAME_LENGTH
  )

/**
 * The answer of a run: the text written after the last command call. What the
 * model wrote before a call only leads up to it
 */
function answerText(state: ChatToolLoopState): string {
  let lastCall = -1
  state.parts.forEach((part, index) => {
    if (part.type === 'tool-call' || part.type === 'tool-result')
      lastCall = index
  })
  return state.parts
    .slice(lastCall + 1)
    .flatMap((part) => (part.type === 'text' ? [part.text] : []))
    .join('')
}

export class QuietRunConfirmationError extends Error {
  constructor() {
    super('A tool in this command requires confirmation')
  }
}

/**
 * Runs the agent of an AI command on `text`: the model follows the prompt and
 * may run the given commands as its tools, through the same loop and tool
 * policy as the chat. Resolves with its final answer, the text written after
 * the last command it ran, or the output of that command when the model wrote
 * nothing after it
 *
 * @throws LlmError
 */
export function createAiCommandRunner(deps: AiCommandRunnerDependencies) {
  return async (
    config: AiCommandOperationConfig,
    text: string,
    tools: readonly AiCommandAgentTool[],
    options: AiCommandRunOptions
  ): Promise<string> => {
    const maxSteps = deps.defaultMaxSteps()
    const confirmationAbort = options.isQuiet
      ? new AbortController()
      : undefined
    const signal = confirmationAbort
      ? AbortSignal.any([options.signal, confirmationAbort.signal])
      : options.signal
    const requiresConfirmation = () => {
      const error = new QuietRunConfirmationError()
      confirmationAbort?.abort(error)
      return error
    }
    const checkConfirmation = () => {
      if (confirmationAbort?.signal.aborted)
        confirmationAbort.signal.throwIfAborted()
    }
    let callsUsed = 0
    /** What the last command that ran returned */
    let lastResult = ''
    const labels = new Map<string, string>()
    /** Counts a call against the limit; parallel calls share the budget */
    const reserveCall = () => {
      if (callsUsed >= maxSteps) return false
      callsUsed += 1
      return true
    }
    const definitions: ChatToolDefinition[] = tools.map((tool, index) => {
      const name = agentToolName(index, tool.commandId)
      labels.set(name, tool.label)
      return {
        name,
        source: COMMANDS_SOURCE,
        catalogName: tool.commandId,
        risk: 'external',
        label: tool.label,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (input, { signal }) => {
          if (!reserveCall()) return CALL_LIMIT_NOTICE
          const outcome = await tool.execute(
            isRecord(input) ? input : {},
            signal
          )
          if (options.isQuiet && outcome.code === 'ConfirmationRequired')
            throw requiresConfirmation()
          const result = toolResultForModel(outcome)
          // only a text the command returned may stand for the answer, never
          // a status such as `Done` or an i18n key
          if (outcome.content?.trim()) lastResult = outcome.content
          return result
        },
      }
    })
    /** The tools of another source, counted against the same limit */
    const limited = (provider: ChatToolProvider): ChatToolProvider => ({
      ...provider,
      tools: async (context) =>
        (await provider.tools(context)).map((tool) => {
          labels.set(tool.name, tool.label ?? tool.name)
          return {
            ...tool,
            execute: (input, executeOptions) =>
              reserveCall()
                ? tool.execute(input, executeOptions)
                : Promise.resolve(CALL_LIMIT_NOTICE),
          }
        }),
    })

    // Whitelisted tools usually run directly. Quiet jobs surface any request
    // for confirmation as a terminal error.
    const policy = createChatToolPolicy({ canAsk: options.isQuiet === true })
    const scope: ToolScope = {
      kind: 'aiCommand',
      commandId: options.commandId ?? '',
      tools: config.tools,
      catalog: options.catalog,
    }
    const providers: ChatToolProvider[] = [
      { id: 'aiCommand', tools: () => definitions },
      ...(options.providers ?? []).map(limited),
    ]
    const toolSet =
      config.tools.length && (definitions.length || options.providers?.length)
        ? await createChatToolRegistry({
            providers: () => providers,
            policy,
          }).resolve({
            profileId: null,
            modelId: '',
            scope,
            getCurrentScope: options.getCurrentScope,
            callContext: toolCallContextOf(scope),
          })
        : null

    const system = [
      deps.instructions().trim(),
      `Command instructions:\n\n${config.prompt.trim()}`,
    ].join('\n\n')

    let reportedCalls = 0
    const state = await runChatToolLoop(
      {
        stream: (prompt, streamOptions) =>
          deps.stream('aiTask', prompt, streamOptions),
        requestApproval: async () => {
          if (options.isQuiet) throw requiresConfirmation()
          return 'deny'
        },
        policy,
      },
      {
        prompt: {
          system,
          messages: [
            {
              role: 'user',
              content: text.trim()
                ? text
                : 'Carry out the command instructions.',
            },
          ],
        },
        tools: toolSet,
        // the calls the command allows, then the answer
        maxStepCount: maxSteps + 1,
        signal,
        onUpdate: (update) => {
          const calls = update.parts.filter((part) => part.type === 'tool-call')
          for (const call of calls.slice(reportedCalls)) {
            const label = labels.get(call.toolName)
            if (label) options.onStep?.(label)
          }
          reportedCalls = calls.length
        },
      }
    ).catch((error: unknown) => {
      checkConfirmation()
      throw error
    })
    checkConfirmation()
    const final = cleanLlmOutput(answerText(state), text)
    // commands ran but the model said nothing after them: their output is the answer
    return final.trim() ? final : lastResult
  }
}
