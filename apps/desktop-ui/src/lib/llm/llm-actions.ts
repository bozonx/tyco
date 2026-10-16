import type { AppConfig, UserConfig, ChatMessage } from '@tyco/shared'
import { LlmInstructionKind } from '../../types'
import {
  CHAT_TITLE_INSTRUCTIONS,
  chatTitleSource,
  cleanGeneratedTitle,
} from '../chat/chat-title'
import type {
  createLlmRequest,
  AiChatTurnOptions,
  AiRequestOptions,
} from './llm-request'

export interface LlmActionsDependencies {
  aiRequest: ReturnType<typeof createLlmRequest>
  getUserConfig: () => UserConfig
  getAppConfig: () => AppConfig
  notifyEmptyText: () => void
}

export function createLlmActions(deps: LlmActionsDependencies) {
  const { aiRequest } = deps
  const voiceCorrection = async (text: string, signal?: AbortSignal) => {
    const userConfig = deps.getUserConfig()

    return await aiRequest(LlmInstructionKind.VOICE_CORRECTION, text, {
      instructions:
        deps.getAppConfig().aiInstructions[LlmInstructionKind.VOICE_CORRECTION],
      rules: userConfig.aiRules?.voiceCorrection,
      signal,
    })
  }

  /**
   * A chat turn. The chat decides its instructions and rules: "Ask AI" and a
   * profile follow different ones
   */
  const sendChatMessage = async (
    message: string | ChatMessage,
    prevMessages: ChatMessage[],
    devInstructions: string | undefined,
    options: Omit<AiChatTurnOptions, 'models' | 'instructions' | 'rules'> & {
      modelId: string
      rules?: string
    }
  ) => {
    const { modelId, rules, ...rest } = options
    return await aiRequest.chatTurn(
      [
        ...prevMessages,
        typeof message === 'string'
          ? { role: 'user', content: message }
          : message,
      ],
      {
        ...rest,
        models: [modelId],
        notifyError: false,
        instructions:
          devInstructions ??
          deps.getAppConfig().aiInstructions[LlmInstructionKind.CHAT],
        rules,
      }
    )
  }

  /** A short title for a conversation; empty when none came out */
  const generateChatTitle = async (
    question: string,
    answer: string,
    modelId: string,
    signal?: AbortSignal
  ) => {
    const raw = await aiRequest(
      LlmInstructionKind.CHAT,
      chatTitleSource(question, answer),
      {
        models: [modelId],
        notifyError: false,
        instructions: CHAT_TITLE_INSTRUCTIONS,
        signal,
      }
    )
    return cleanGeneratedTitle(raw)
  }

  const correctText = async (
    text: string,
    options: Pick<AiRequestOptions, 'signal' | 'notifyError'> = {}
  ) => {
    if (!text?.trim()) {
      deps.notifyEmptyText()
      return ''
    }

    const userConfig = deps.getUserConfig()

    return await aiRequest(LlmInstructionKind.CORRECTION, text, {
      ...options,
      instructions:
        deps.getAppConfig().aiInstructions[LlmInstructionKind.CORRECTION],
      rules: userConfig.aiRules?.correction,
    })
  }

  /** Applies an own request typed in the AI task menu, like a task's rule */
  const aiCustomPrompt = async (
    prompt: string,
    text?: string,
    options: Pick<AiRequestOptions, 'signal' | 'notifyError'> = {}
  ) => {
    if (!text?.trim()) {
      deps.notifyEmptyText()
      return ''
    }
    if (!prompt.trim()) return ''

    return await aiRequest(LlmInstructionKind.AI_TASKS, text, {
      ...options,
      instructions:
        deps.getAppConfig().aiInstructions[LlmInstructionKind.AI_TASKS],
      rules: prompt.trim(),
    })
  }

  return {
    aiRequest,
    voiceCorrection,
    sendChatMessage,
    generateChatTitle,
    correctText,
    aiCustomPrompt,
  }
}
