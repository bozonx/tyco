import { isRecord } from '@tyco/shared/value-guards'
import {
  COMMANDS_TOOL_GROUP_ID,
  type AiCommandOperationConfig,
  type ProfileToolSettings,
} from '@tyco/shared'

import {
  runChatToolLoop,
  type ChatToolLoopState,
} from '../chat-tools/chat-tool-loop'
import { createChatToolPolicy } from '../chat-tools/chat-tool-policy'
import {
  createChatToolRegistry,
  type ChatToolDefinition,
} from '../chat-tools/chat-tool-registry'
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
}

export interface AiCommandRunOptions {
  signal: AbortSignal
  /** Tells which command the agent runs now, by its name */
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
    let callsUsed = 0
    /** What the last command that ran returned */
    let lastResult = ''
    const labels = new Map<string, string>()
    const definitions: ChatToolDefinition[] = tools.map((tool, index) => {
      const name = agentToolName(index, tool.commandId)
      labels.set(name, tool.label)
      return {
        name,
        groupId: COMMANDS_TOOL_GROUP_ID,
        label: tool.label,
        description: tool.description,
        inputSchema: tool.inputSchema,
        execute: async (input, { signal }) => {
          // Reserve before awaiting: parallel calls share the same budget.
          if (callsUsed >= config.maxSteps) return CALL_LIMIT_NOTICE
          callsUsed += 1
          const result = toolResultForModel(
            await tool.execute(isRecord(input) ? input : {}, signal)
          )
          lastResult = result
          return result
        },
      }
    })

    // The user picked the commands of the agent, and an AI command often runs
    // with no window to ask in: they run without asking
    const policy = createChatToolPolicy({ canAsk: false })
    const settings: ProfileToolSettings = {
      groups: {
        [COMMANDS_TOOL_GROUP_ID]: { isEnabled: true, access: 'allow' },
      },
    }
    const toolSet = definitions.length
      ? await createChatToolRegistry({
          providers: () => [{ id: 'aiCommand', tools: () => definitions }],
          policy,
        }).resolve({ profileId: null, modelId: '', settings })
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
        requestApproval: () => Promise.resolve('deny'),
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
        maxStepCount: config.maxSteps + 1,
        signal: options.signal,
        onUpdate: (update) => {
          const calls = update.parts.filter((part) => part.type === 'tool-call')
          for (const call of calls.slice(reportedCalls)) {
            const label = labels.get(call.toolName)
            if (label) options.onStep?.(label)
          }
          reportedCalls = calls.length
        },
      }
    )
    const final = cleanLlmOutput(answerText(state), text)
    // commands ran but the model said nothing after them: their output is the answer
    return final.trim() ? final : lastResult
  }
}
