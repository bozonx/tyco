import { ref } from 'vue'
import type {
  AppConfig,
  Chat,
  ChatAttachment,
  ChatMessage,
  ChatMessagePart,
  EditorHistoryInputKind,
  EditorHistoryInstruction,
  EditorHistoryTurn,
  UserConfig,
  AiProfile,
} from '@tyco/shared'
import { errorMessage } from '@tyco/shared/value-guards'
import {
  extractReplyBlocks,
  REPLY_BLOCKS_TOOL_NAME,
  withReplyBlocksTool,
  type ReplyBlockData,
} from '../reply-blocks/reply-blocks-tool'
import {
  runChatToolLoop,
  type ChatToolLoopDependencies,
} from '../chat-tools/chat-tool-loop'
import { createChatToolApprovals } from '../chat-tools/chat-tool-approvals'
import {
  createChatToolPolicy,
  type ChatToolDecision,
  type ChatToolPolicy,
} from '../chat-tools/chat-tool-policy'
import type { ChatToolSet } from '../chat-tools/chat-tool-registry'
import { buildLlmPrompt } from '../llm/llm-prompt'
import type { LlmStreamEvent, LlmStreamOptions } from '../llm/llm-client'
import type { LlmPrompt } from '../llm/llm-prompt'

export interface QuickAiRequestTurn {
  id: string
  prompt: string
  inputKind: 'text' | 'voice'
  parts: ChatMessagePart[]
  replyBlocks: ReplyBlockData[]
  textResponse: string
  status: 'generating' | 'done' | 'error'
  error?: string
}

export interface QuickAiRequestModelDependencies {
  sourceText?: string
  initialInputMode?: 'text' | 'voice'
  initialProfileId?: string | null

  // Config & Model
  getUserConfig: () => UserConfig
  getAppConfig: () => AppConfig
  getAvailableTools: (modelId: string, profile?: AiProfile) => Promise<{
    tools: ChatToolSet | null
    policy?: ChatToolPolicy
    maxStepCount?: number
  }>

  // LLM stream
  stream: (
    prompt: LlmPrompt,
    options: LlmStreamOptions
  ) => AsyncIterable<LlmStreamEvent>

  // Profile instructions & metadata
  resolveProfileInstructions: (profileId: string) => Promise<string>
  getProfile?: (profileId: string) => AiProfile | undefined

  // History
  saveEditorHistorySession: (entry: {
    sourceText?: string
    profileId?: string | null
    instruction: EditorHistoryInstruction
    operation: 'quickAiRequest'
    turns: EditorHistoryTurn[]
    result?: string
  }) => Promise<string | null | undefined>
  updateEditorHistorySession: (
    id: string,
    turns: EditorHistoryTurn[],
    result?: string | null
  ) => Promise<void>
  listRecentInstructions?: (limit?: number, profileId?: string | null) => string[]

  // Text insertion / Actions
  insertText: (text: string) => Promise<void>
  copyText: (text: string) => Promise<void>
  toEditor: (text: string, sourceText?: string) => Promise<void>

  // Navigation / Chat transition
  openMainChat: (params: {
    attachment?: ChatAttachment
    question?: string
    profileId?: string
    chatId?: string
    autoSend?: boolean
  }) => Promise<void>
  saveChat?: (chat: Chat, profileId?: string) => Promise<void>
  createId: () => string
  closeOverlay: () => void

  // Custom error strings / callbacks
  noModelError?: () => string
  toolsUnsupportedError?: () => string
}

export function createQuickAiRequestModel(deps: QuickAiRequestModelDependencies) {
  const inputMode = ref<'text' | 'voice'>(deps.initialInputMode ?? 'text')
  const profileId = ref<string | null>(deps.initialProfileId ?? null)
  const isProfileLocked = ref(false)
  const isGenerating = ref(false)
  const turns = ref<QuickAiRequestTurn[]>([])
  const error = ref<string | null>(null)
  const historySessionId = ref<string | null>(null)

  const approvals = createChatToolApprovals()
  let abortController: AbortController | null = null

  const extractAllReplyBlocks = (parts: ChatMessagePart[]): ReplyBlockData[] => {
    const blocks: ReplyBlockData[] = []
    for (const part of parts) {
      if (part.type === 'tool-call' && part.toolName === REPLY_BLOCKS_TOOL_NAME) {
        blocks.push(...extractReplyBlocks(part.input))
      }
    }
    return blocks
  }

  const setInputMode = (mode: 'text' | 'voice') => {
    inputMode.value = mode
  }

  const setProfileId = (id: string | null) => {
    if (isProfileLocked.value) return
    profileId.value = id
  }

  const stopGeneration = () => {
    if (abortController) {
      abortController.abort()
      abortController = null
    }
    approvals.cancelAll()
    isGenerating.value = false
    const lastTurn = turns.value.at(-1)
    if (lastTurn && lastTurn.status === 'generating') {
      lastTurn.status = 'done'
    }
  }

  const answerToolApproval = (approvalId: string, decision: ChatToolDecision) => {
    approvals.answer(approvalId, decision)
  }

  const getRecentInstructions = (limit = 5): string[] => {
    return deps.listRecentInstructions?.(limit, profileId.value) ?? []
  }

  const submitPrompt = async (
    promptText: string,
    mode: 'text' | 'voice' = inputMode.value
  ): Promise<boolean> => {
    const trimmed = promptText.trim()
    if (!trimmed || isGenerating.value) return false

    error.value = null

    // 1. Validate model and tool capability
    const userConfig = deps.getUserConfig()
    const taskConfig = userConfig.llm?.tasks?.quickRequest
    const modelId = taskConfig?.modelId
    const model = modelId
      ? userConfig.llm?.models?.find((m) => m.id === modelId)
      : undefined

    if (!modelId || !model) {
      error.value =
        deps.noModelError?.() ??
        'No language model is configured for quick AI request. Please configure it in settings.'
      return false
    }

    if (!model.canUseTools) {
      error.value =
        deps.toolsUnsupportedError?.() ??
        'The configured model does not support tool calls. Please select a model with tool support in settings.'
      return false
    }

    // 2. Lock profile after first generation starts
    isProfileLocked.value = true
    isGenerating.value = true

    // 3. Create turn
    const turnId = deps.createId()
    const turn: QuickAiRequestTurn = {
      id: turnId,
      prompt: trimmed,
      inputKind: mode,
      parts: [],
      replyBlocks: [],
      textResponse: '',
      status: 'generating',
    }
    turns.value.push(turn)

    // 4. Save history session if first turn
    const currentTurnIndex = turns.value.length - 1
    const historyInputKind: EditorHistoryInputKind =
      mode === 'voice' ? 'voice' : 'typed'
    if (currentTurnIndex === 0) {
      try {
        const savedId = await deps.saveEditorHistorySession({
          sourceText: deps.sourceText,
          profileId: profileId.value,
          instruction: {
            text: trimmed,
            inputKind: historyInputKind,
          },
          operation: 'quickAiRequest',
          turns: [{ prompt: trimmed, inputKind: historyInputKind }],
        })
        if (savedId) historySessionId.value = savedId
      } catch {
        // history failure shouldn't block LLM call
      }
    } else if (historySessionId.value) {
      try {
        const historyTurns: EditorHistoryTurn[] = turns.value.map((t) => ({
          prompt: t.prompt,
          result: t.replyBlocks[0]?.text || t.textResponse || undefined,
          inputKind: t.inputKind === 'voice' ? 'voice' : 'typed',
        }))
        await deps.updateEditorHistorySession(
          historySessionId.value,
          historyTurns
        )
      } catch {
        // ignore
      }
    }

    // 5. Build conversation history
    const conversation: ChatMessage[] = []
    for (let i = 0; i < turns.value.length; i++) {
      const t = turns.value[i]
      if (i < currentTurnIndex) {
        conversation.push({
          role: 'user',
          content: t.prompt,
          ...(i === 0 && deps.sourceText
            ? { attachments: [{ text: deps.sourceText, source: 'selection' }] }
            : {}),
        })
        conversation.push({
          role: 'assistant',
          content: t.textResponse,
          parts: t.parts,
        })
      } else {
        // Active turn
        conversation.push({
          role: 'user',
          content: t.prompt,
          ...(i === 0 && deps.sourceText
            ? { attachments: [{ text: deps.sourceText, source: 'selection' }] }
            : {}),
        })
      }
    }

    // 6. Build prompt & instructions
    abortController = new AbortController()
    const signal = abortController.signal

    try {
      const appConfig = deps.getAppConfig()
      const profileInstructions = profileId.value
        ? await deps.resolveProfileInstructions(profileId.value)
        : ''

      const instructions = [
        appConfig.aiInstructions?.quickRequest,
        profileInstructions,
      ]
        .filter(Boolean)
        .join('\n\n')

      const llmPrompt = buildLlmPrompt(conversation, {
        instructions,
        rules: taskConfig.rule,
        rulePrefix: appConfig.rulePrefix,
        canUseTools: true,
      })

      // 7. Resolve tools & policy
      const selectedProfile = profileId.value
        ? deps.getProfile?.(profileId.value)
        : undefined
      const available = await deps.getAvailableTools(modelId, selectedProfile)
      const toolSet = withReplyBlocksTool(available.tools)

      const loopDeps: ChatToolLoopDependencies = {
        stream: (p, opt) => deps.stream(p, opt),
        requestApproval: (req, sig) => approvals.request(req, sig),
        policy: available.policy ?? createChatToolPolicy({ canAsk: true }),
      }

      const result = await runChatToolLoop(loopDeps, {
        prompt: llmPrompt,
        tools: toolSet,
        maxStepCount: available.maxStepCount ?? 5,
        signal,
        onUpdate: (state) => {
          turn.textResponse = state.content
          turn.parts = [...state.parts]
          turn.replyBlocks = extractAllReplyBlocks(state.parts)
        },
      })

      turn.textResponse = result.content
      turn.parts = [...result.parts]
      turn.replyBlocks = extractAllReplyBlocks(result.parts)
      turn.status = 'done'

      // 8. Update history with results
      if (historySessionId.value) {
        const finalResult =
          turn.replyBlocks[0]?.text || turn.textResponse || undefined
        const historyTurns: EditorHistoryTurn[] = turns.value.map((t) => ({
          prompt: t.prompt,
          result: t.replyBlocks[0]?.text || t.textResponse || undefined,
          inputKind: t.inputKind === 'voice' ? 'voice' : 'typed',
        }))
        await deps.updateEditorHistorySession(
          historySessionId.value,
          historyTurns,
          finalResult
        )
      }

      return true
    } catch (err) {
      if (signal.aborted) {
        turn.status = 'done'
        return false
      }
      const msg = errorMessage(err)
      turn.status = 'error'
      turn.error = msg
      error.value = msg
      return false
    } finally {
      isGenerating.value = false
      abortController = null
    }
  }

  const applyReplyBlock = async (
    block: ReplyBlockData,
    target: 'window' | 'editor' | 'copy'
  ) => {
    if (target === 'copy') {
      await deps.copyText(block.text)
      return
    }

    if (historySessionId.value) {
      const historyTurns: EditorHistoryTurn[] = turns.value.map((t) => ({
        prompt: t.prompt,
        result: t.replyBlocks[0]?.text || t.textResponse || undefined,
        inputKind: t.inputKind === 'voice' ? 'voice' : 'typed',
      }))
      void deps.updateEditorHistorySession(
        historySessionId.value,
        historyTurns,
        block.text
      )
    }

    if (target === 'window') {
      await deps.insertText(block.text)
      deps.closeOverlay()
    } else if (target === 'editor') {
      await deps.toEditor(block.text, deps.sourceText)
      deps.closeOverlay()
    }
  }

  const switchToChat = async (currentInputDraft?: string) => {
    stopGeneration()

    if (turns.value.length === 0) {
      await deps.openMainChat({
        attachment: deps.sourceText
          ? { text: deps.sourceText, source: 'selection' }
          : undefined,
        question: currentInputDraft?.trim() || undefined,
        profileId: profileId.value ?? undefined,
      })
      deps.closeOverlay()
      return
    }

    const chatMessages: ChatMessage[] = []
    for (let i = 0; i < turns.value.length; i++) {
      const t = turns.value[i]
      chatMessages.push({
        role: 'user',
        content: t.prompt,
        ...(i === 0 && deps.sourceText
          ? { attachments: [{ text: deps.sourceText, source: 'selection' }] }
          : {}),
      })
      chatMessages.push({
        role: 'assistant',
        content: t.textResponse,
        parts: t.parts,
        status: t.status === 'generating' ? 'stopped' : 'complete',
      })
    }

    const chatId = deps.createId()
    const firstPrompt = turns.value[0]?.prompt.slice(0, 50) || 'Quick AI Request'
    const now = Date.now()
    const chat: Chat = {
      id: chatId,
      title: firstPrompt,
      lastMessageAt: now,
      messages: chatMessages,
    }

    if (deps.saveChat) {
      await deps.saveChat(chat, profileId.value ?? undefined)
    }

    await deps.openMainChat({
      chatId,
      profileId: profileId.value ?? undefined,
      question: currentInputDraft?.trim() || undefined,
    })
    deps.closeOverlay()
  }

  return {
    inputMode,
    profileId,
    isProfileLocked,
    isGenerating,
    turns,
    error,
    historySessionId,
    setInputMode,
    setProfileId,
    stopGeneration,
    answerToolApproval,
    getRecentInstructions,
    submitPrompt,
    applyReplyBlock,
    switchToChat,
  }
}

export type QuickAiRequestModel = ReturnType<typeof createQuickAiRequestModel>
