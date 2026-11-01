import { dynamicTool, jsonSchema, type ToolSet } from '@bozonx/ai-kit'
import { isRecord } from '@tyco/shared/value-guards'
import type { AiCommandToolConfig } from '@tyco/shared'

import { toolResultForModel } from '../chat-tools/registered-tool-adapter'
import type {
  LlmRunName,
  LlmStreamEvent,
  LlmStreamOptions,
} from '../llm/llm-client'
import { cleanLlmOutput } from '../llm/llm-output'
import type { LlmPrompt } from '../llm/llm-prompt'
import type { JsonSchema, ToolResult } from '../tools/tool-types'

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
  ) => Promise<ToolResult>
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
 * A name the AI providers accept for the tool of a command: the index keeps
 * apart ids that differ only in characters a name cannot have
 */
export const agentToolName = (index: number, commandId: string): string =>
  `c${index}_${commandId.replace(/[^a-zA-Z0-9_-]/g, '_')}`.slice(
    0,
    TOOL_NAME_LENGTH
  )

/**
 * Runs the agent of an AI command on `text`: the model follows the prompt and
 * may run the given commands as its tools. Resolves with its final answer, the
 * text written after the last command it ran
 *
 * @throws LlmError
 */
export function createAiCommandRunner(deps: AiCommandRunnerDependencies) {
  return async (
    config: AiCommandToolConfig,
    text: string,
    tools: readonly AiCommandAgentTool[],
    options: AiCommandRunOptions
  ): Promise<string> => {
    const byName = new Map<string, AiCommandAgentTool>()
    const toolSet: ToolSet = {}
    tools.forEach((tool, index) => {
      const name = agentToolName(index, tool.commandId)
      byName.set(name, tool)
      toolSet[name] = dynamicTool({
        description: tool.description,
        inputSchema: jsonSchema(
          tool.inputSchema as Parameters<typeof jsonSchema>[0]
        ),
        execute: async (input, { abortSignal }) =>
          toolResultForModel(
            await tool.execute(
              isRecord(input) ? input : {},
              abortSignal ?? options.signal
            )
          ),
      })
    })

    const system = [
      deps.instructions().trim(),
      `Command instructions:\n\n${config.prompt.trim()}`,
    ].join('\n\n')

    let answer = ''
    for await (const event of deps.stream(
      'aiTask',
      { system, messages: [{ role: 'user', content: text }] },
      {
        signal: options.signal,
        ...(tools.length ? { tools: toolSet, maxSteps: config.maxSteps } : {}),
      }
    )) {
      if (event.type === 'text') {
        answer += event.text
      } else if (event.type === 'tool-call') {
        // what the model wrote before a call leads up to it, not the answer
        answer = ''
        const tool = byName.get(event.toolName)
        if (tool) options.onStep?.(tool.label)
      }
    }
    return cleanLlmOutput(answer, text)
  }
}
