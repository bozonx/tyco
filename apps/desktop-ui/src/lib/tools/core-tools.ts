import type { CoreToolId, LlmTask } from '@tyco/shared'

import {
  TEXT_INPUT_SCHEMA,
  type ToolCall,
  type ToolDefinition,
  type ToolResult,
} from './tool-types'

export interface CoreToolDependencies {
  /** Pastes the text into the window the app was called over and hides it */
  insertText: (text: string) => Promise<void>
  /** Puts the text into the clipboard; the windows stay as they are */
  copyText: (text: string) => Promise<void>
  /** Opens the chat with the text attached */
  askInChat: (text: string) => Promise<void>
  correctText: (text: string, signal: AbortSignal) => Promise<string>
  translateTo: (
    language: string,
    text: string,
    signal: AbortSignal
  ) => Promise<string>
  aiCustomPrompt: (
    prompt: string,
    text: string,
    signal: AbortSignal
  ) => Promise<string>
  /** Why the task cannot run on the LLM, as an i18n key */
  llmUnavailable: (task: LlmTask) => string | undefined
  /** Why the translator cannot run, as an i18n key */
  translatorUnavailable: () => string | undefined
  /** A message for a failure of the LLM or the translator */
  describeError: (error: unknown) => string
}

const textOf = (call: ToolCall): string =>
  typeof call.input.text === 'string' ? call.input.text : ''

const stringOf = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const noText: ToolResult = {
  ok: false,
  level: 'warn',
  messageKey: 'toast.textNotSelected',
}

/**
 * A tool that turns the text into another one with the LLM or the translator;
 * the command decides what to do with the result
 */
function transformTool(
  deps: CoreToolDependencies,
  tool: Omit<ToolDefinition, 'run' | 'inputSchema'>,
  transform: (call: ToolCall, text: string) => Promise<string> | ToolResult
): ToolDefinition {
  return {
    defaultAfterRun: 'replaceSelection',
    ...tool,
    inputSchema: TEXT_INPUT_SCHEMA,
    run: async (call) => {
      const text = textOf(call)
      if (!text.trim()) return noText
      try {
        const result = transform(call, text)
        if (!(result instanceof Promise)) return result
        const content = await result
        if (call.signal.aborted) return { ok: false, cancelled: true }
        return content.trim()
          ? { ok: true, content }
          : { ok: false, messageKey: 'selection.emptyResult' }
      } catch (error) {
        if (call.signal.aborted) return { ok: false, cancelled: true }
        return { ok: false, message: deps.describeError(error) }
      }
    },
  }
}

/** The tools over what the app already does; they add no behavior of their own */
export function createCoreTools(deps: CoreToolDependencies): ToolDefinition[] {
  const insert: ToolDefinition = {
    id: 'core.insert' satisfies CoreToolId,
    labelKey: 'tools.insert',
    descriptionKey: 'tools.insertDescription',
    icon: 'mdi:keyboard-outline',
    description:
      'Types the text into the window the user was working in, as if pasted',
    inputSchema: TEXT_INPUT_SCHEMA,
    run: async (call) => {
      const text = textOf(call)
      if (!text.trim()) return noText
      await deps.insertText(text)
      // the window is hidden already, and the text is where it shows
      return { ok: true, keepWindow: true }
    },
  }

  const copy: ToolDefinition = {
    id: 'core.copy' satisfies CoreToolId,
    labelKey: 'tools.copy',
    descriptionKey: 'tools.copyDescription',
    icon: 'mdi:content-copy',
    description: 'Puts the text into the clipboard',
    inputSchema: TEXT_INPUT_SCHEMA,
    run: async (call) => {
      const text = textOf(call)
      if (!text.trim()) return noText
      try {
        await deps.copyText(text)
      } catch (error) {
        return { ok: false, message: deps.describeError(error) }
      }
      return { ok: true, messageKey: 'toast.copied' }
    },
  }

  const askInChat: ToolDefinition = {
    id: 'core.askInChat' satisfies CoreToolId,
    labelKey: 'tools.askInChat',
    descriptionKey: 'tools.askInChatDescription',
    icon: 'mdi:chat-processing-outline',
    description: 'Opens the chat of the app with the text attached',
    inputSchema: TEXT_INPUT_SCHEMA,
    run: async (call) => {
      const text = textOf(call)
      if (!text.trim()) return noText
      await deps.askInChat(text)
      // the chat opens in the main window, which the quick one hands over to
      return { ok: true, keepWindow: true }
    },
  }

  const correct = transformTool(
    deps,
    {
      id: 'core.correct' satisfies CoreToolId,
      labelKey: 'tools.correct',
      descriptionKey: 'tools.correctDescription',
      icon: 'mdi:spellcheck',
      description:
        'Corrects spelling, grammar and punctuation of the text with the LLM',
      unavailableReason: () => deps.llmUnavailable('correction'),
    },
    (call, text) => deps.correctText(text, call.signal)
  )

  const translate = transformTool(
    deps,
    {
      id: 'core.translate' satisfies CoreToolId,
      labelKey: 'tools.translate',
      descriptionKey: 'tools.translateDescription',
      icon: 'mdi:translate',
      description: 'Translates the text into the language of the command',
      unavailableReason: () => deps.translatorUnavailable(),
    },
    (call, text) => {
      const language = stringOf(call.config.language)
      if (!language) {
        return { ok: false, messageKey: 'commands.errorNoLanguage' }
      }
      return deps.translateTo(language, text, call.signal)
    }
  )

  const aiTask = transformTool(
    deps,
    {
      id: 'core.aiTask' satisfies CoreToolId,
      labelKey: 'tools.aiTask',
      descriptionKey: 'tools.aiTaskDescription',
      icon: 'mdi:robot-outline',
      description:
        'Applies the instruction of the command to the text with the LLM',
      unavailableReason: () => deps.llmUnavailable('aiTasks'),
    },
    (call, text) => {
      const prompt = stringOf(call.config.prompt)
      if (!prompt) return { ok: false, messageKey: 'commands.errorNoPrompt' }
      return deps.aiCustomPrompt(prompt, text, call.signal)
    }
  )

  return [insert, copy, correct, translate, aiTask, askInChat]
}
