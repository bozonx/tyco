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
import { cleanLlmOutput } from './llm-output'

type TextTaskKind =
  | LlmInstructionKind.CORRECTION
  | LlmInstructionKind.AI_TASK
  | LlmInstructionKind.TRANSFORMATION
  | LlmInstructionKind.STYLING

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
      rules: userConfig.llm?.tasks.voiceCorrection.rule,
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
        modelId,
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
        modelId,
        notifyError: false,
        instructions: CHAT_TITLE_INSTRUCTIONS,
        signal,
      }
    )
    return cleanGeneratedTitle(raw)
  }

  type TextTaskOptions = Pick<AiRequestOptions, 'signal' | 'notifyError'>

  /**
   * Runs a task over `text` under `rules`; the result comes without the
   * wrapping a model may add. An empty text is reported unless errors are not
   */
  const runTextTask = async (
    kind: TextTaskKind,
    text: string | undefined,
    rules: string | undefined,
    options: TextTaskOptions
  ): Promise<string> => {
    if (!text?.trim()) {
      if (options.notifyError !== false) deps.notifyEmptyText()
      return ''
    }
    const result = await aiRequest(kind, text, {
      ...options,
      instructions: deps.getAppConfig().aiInstructions[kind],
      rules,
    })
    return result ? cleanLlmOutput(result, text) : result
  }

  /** Runs a task under an own instruction, which must not be empty */
  const promptTask =
    (kind: TextTaskKind) =>
    (prompt: string, text?: string, options: TextTaskOptions = {}) => {
      const rules = prompt.trim()
      if (!rules) return Promise.reject(new Error('The instruction is empty'))
      return runTextTask(kind, text, rules, options)
    }

  const correctText = (text: string, options: TextTaskOptions = {}) =>
    runTextTask(
      LlmInstructionKind.CORRECTION,
      text,
      deps.getUserConfig().llm?.tasks.correction.rule,
      options
    )

  /** Applies an own request typed in the AI task menu, like a task's rule */
  const aiCustomPrompt = promptTask(LlmInstructionKind.AI_TASK)
  const transformationPrompt = promptTask(LlmInstructionKind.TRANSFORMATION)
  const stylingPrompt = promptTask(LlmInstructionKind.STYLING)

  return {
    aiRequest,
    voiceCorrection,
    sendChatMessage,
    generateChatTitle,
    correctText,
    aiCustomPrompt,
    transformationPrompt,
    stylingPrompt,
  }
}
