import {
  dynamicTool,
  jsonSchema,
  toolApprovalResponse,
  type ModelMessage,
  type ToolApproval,
  type ToolSet,
} from '@bozonx/ai-kit'
import type { AiTaskConfig, AiTaskOutputAction } from '@tyco/shared'

import type { LlmPrompt } from '../llm/llm-prompt'
import type {
  LlmRunName,
  LlmStreamEvent,
  LlmStreamOptions,
} from '../llm/llm-client'
import type { RegisteredTool, ToolResult } from '../tools/tool-types'

export const FOCUS_LOSS_TIMEOUT_MS = 4000

export const STRICT_REPLACE_INSTRUCTION =
  "Attention: Your text response will directly replace the selected text in the user's document. Do not include greetings, confirmations, explanations, or quotes. Return ONLY the final replacement text."

export type TaskToolCallStatus =
  'loading' | 'done' | 'error' | 'awaiting-approval' | 'denied'

export interface TaskToolCall {
  toolCallId: string
  toolId: string
  toolName: string
  input: unknown
  output?: string
  status: TaskToolCallStatus
}

export interface TaskApprovalRequest {
  approvalId: string
  toolCallId: string
  toolId: string
  toolName: string
  input: unknown
}

export interface TaskRunState {
  status: 'running' | 'done' | 'error' | 'cancelled'
  reasoning: string
  text: string
  toolCalls: TaskToolCall[]
  error?: string
}

export interface TaskRunResult {
  content: string
  reasoning: string
  toolCalls: TaskToolCall[]
  effectiveOutputAction: AiTaskOutputAction
  wasFocusGuardTriggered: boolean
  stepsUsed: number
}

export interface TaskRunnerDependencies {
  stream: (
    task: LlmRunName,
    prompt: LlmPrompt,
    options?: LlmStreamOptions
  ) => AsyncIterable<LlmStreamEvent>
  getTool: (toolId: string) => RegisteredTool | undefined
  getToolPolicy?: (toolId: string) => 'allow' | 'ask' | 'deny'
  requestApproval?: (
    request: TaskApprovalRequest,
    signal: AbortSignal
  ) => Promise<boolean>
  canInsertIntoTarget?: () => boolean
  now?: () => number
}

export interface TaskRunOptions {
  signal?: AbortSignal
  onUpdate?: (state: TaskRunState) => void
}

function toolResultForModel(result: ToolResult): string {
  if (result.cancelled) throw new Error('The tool call was cancelled')
  const message = result.message?.trim() || result.messageKey
  if (!result.ok) throw new Error(message || 'The tool call failed')
  return result.content ?? message ?? 'Done'
}

function normalizeToolId(toolId: string): string {
  return toolId.replace(':', '.')
}

export function createTaskRunner(deps: TaskRunnerDependencies) {
  const getNow = deps.now ?? Date.now

  async function run(
    task: AiTaskConfig,
    inputText: string,
    options: TaskRunOptions = {}
  ): Promise<TaskRunResult> {
    const signal = options.signal ?? new AbortController().signal
    const startTime = getNow()

    // 1. Resolve and adapt allowed tools
    const nameToId = new Map<string, string>()
    const idToName = new Map<string, string>()
    const tools: ToolSet = {}

    for (const rawId of task.allowedTools ?? []) {
      const tool = deps.getTool(rawId) ?? deps.getTool(normalizeToolId(rawId))
      if (!tool) continue

      const safeName = tool.id.replace(/[^a-zA-Z0-9_-]/g, '_')
      nameToId.set(safeName, tool.id)
      idToName.set(tool.id, safeName)

      tools[safeName] = dynamicTool({
        description: tool.description,
        inputSchema: jsonSchema(
          tool.inputSchema as Parameters<typeof jsonSchema>[0]
        ),
        execute: async (input, { abortSignal }) => {
          const result = await tool.run({
            input:
              input && typeof input === 'object' && !Array.isArray(input)
                ? (input as Record<string, unknown>)
                : {},
            config: tool.baseConfig?.() ?? {},
            source: 'menu',
            signal: abortSignal ?? signal,
            isOutputRequested: true,
          })
          return toolResultForModel(result)
        },
      })
    }

    const hasTools = Object.keys(tools).length > 0

    const toolApproval: ToolApproval = ({ toolCall }) => {
      const originalId = nameToId.get(toolCall.toolName) ?? toolCall.toolName
      const policy = deps.getToolPolicy?.(originalId) ?? 'allow'
      if (policy === 'allow') return 'approved'
      if (policy === 'deny') return 'denied'
      return 'user-approval'
    }

    // 2. Prepare system prompt and messages
    const systemPromptParts: string[] = []
    if (task.outputAction === 'replace') {
      systemPromptParts.push(STRICT_REPLACE_INSTRUCTION)
    }
    if (task.prompt.trim()) {
      systemPromptParts.push(`Instructions:\n${task.prompt.trim()}`)
    }
    const system = systemPromptParts.filter(Boolean).join('\n\n')

    let messages: ModelMessage[] = [{ role: 'user', content: inputText }]
    let accumulatedText = ''
    let accumulatedReasoning = ''
    const toolCallsMap = new Map<string, TaskToolCall>()
    let stepsUsed = 0
    const maxSteps = Math.max(1, task.maxSteps || 5)

    const publishUpdate = (status: TaskRunState['status'], error?: string) => {
      options.onUpdate?.({
        status,
        reasoning: accumulatedReasoning,
        text: accumulatedText,
        toolCalls: Array.from(toolCallsMap.values()),
        error,
      })
    }

    publishUpdate('running')

    // 3. Execution loop
    while (!signal.aborted) {
      const pendingApprovals: TaskApprovalRequest[] = []
      let finish: Extract<LlmStreamEvent, { type: 'finish' }> | null = null

      const streamOptions: LlmStreamOptions = {
        signal,
        modelId: task.modelId,
        maxSteps: Math.max(1, maxSteps - stepsUsed),
        ...(hasTools ? { tools, toolApproval } : {}),
      }

      for await (const event of deps.stream(
        'aiTask',
        { system, messages },
        streamOptions
      )) {
        if (signal.aborted) break

        switch (event.type) {
          case 'text':
            accumulatedText += event.text
            publishUpdate('running')
            break
          case 'reasoning':
            accumulatedReasoning += event.text
            publishUpdate('running')
            break
          case 'tool-call': {
            const originalId = nameToId.get(event.toolName) ?? event.toolName
            toolCallsMap.set(event.toolCallId, {
              toolCallId: event.toolCallId,
              toolId: originalId,
              toolName: event.toolName,
              input: event.input,
              status: 'loading',
            })
            publishUpdate('running')
            break
          }
          case 'tool-result': {
            const call = toolCallsMap.get(event.toolCallId)
            if (call) {
              call.status = event.isError ? 'error' : 'done'
              call.output =
                typeof event.output === 'string'
                  ? event.output
                  : JSON.stringify(event.output)
            }
            publishUpdate('running')
            break
          }
          case 'tool-denied': {
            const call = toolCallsMap.get(event.toolCallId)
            if (call) call.status = 'denied'
            publishUpdate('running')
            break
          }
          case 'approval-request': {
            const call = toolCallsMap.get(event.toolCallId)
            if (call) call.status = 'awaiting-approval'
            const originalId = nameToId.get(event.toolName) ?? event.toolName
            pendingApprovals.push({
              approvalId: event.approvalId,
              toolCallId: event.toolCallId,
              toolId: originalId,
              toolName: event.toolName,
              input: event.input,
            })
            publishUpdate('running')
            break
          }
          case 'step-finish':
            stepsUsed += 1
            break
          case 'finish':
            finish = event
            break
        }
      }

      if (signal.aborted) {
        publishUpdate('cancelled')
        throw new Error('Task execution was cancelled')
      }

      if (
        !finish ||
        finish.finishReason === 'stop' ||
        pendingApprovals.length === 0
      ) {
        break
      }

      // Process approvals
      const responses: ModelMessage[] = []
      for (const request of pendingApprovals) {
        let isApproved = false
        if (deps.requestApproval) {
          isApproved = await deps.requestApproval(request, signal)
        }
        if (signal.aborted) {
          publishUpdate('cancelled')
          throw new Error('Task execution was cancelled')
        }

        const call = toolCallsMap.get(request.toolCallId)
        if (call) {
          call.status = isApproved ? 'loading' : 'denied'
        }
        publishUpdate('running')

        responses.push(
          toolApprovalResponse({
            approvalId: request.approvalId,
            approved: isApproved,
            ...(isApproved
              ? {}
              : { reason: 'The user did not allow this tool call.' }),
          })
        )
      }

      messages = [...messages, ...finish.responseMessages, ...responses]
    }

    // 4. Focus Loss Guard
    const elapsed = getNow() - startTime
    const isTargetValid = deps.canInsertIntoTarget
      ? deps.canInsertIntoTarget()
      : true

    let effectiveOutputAction = task.outputAction
    let wasFocusGuardTriggered = false

    if (task.outputAction === 'replace') {
      if (elapsed > FOCUS_LOSS_TIMEOUT_MS || !isTargetValid) {
        effectiveOutputAction = 'show'
        wasFocusGuardTriggered = true
      }
    }

    publishUpdate('done')

    return {
      content: accumulatedText,
      reasoning: accumulatedReasoning,
      toolCalls: Array.from(toolCallsMap.values()),
      effectiveOutputAction,
      wasFocusGuardTriggered,
      stepsUsed,
    }
  }

  return { run }
}
