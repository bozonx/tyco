import type { CoreOperationId, LlmTask } from '@tyco/shared'

import { getLanguageLabelKey } from '../locale/language'
import { parameterValue } from './command-parameters'
import {
  TEXT_INPUT_SCHEMA,
  type OperationCall,
  type OperationDefinition,
  type OperationResult,
} from './operation-types'

export interface TranslateOptions {
  signal: AbortSignal
  /** Detected by the translator when absent */
  sourceLanguage?: string
  onStage?: (stage: string) => void
}

/** A text the LLM or the translator made, with facts about it for the caller */
interface TransformOutput {
  text: string
  meta?: Record<string, unknown>
}

export interface CoreOperationDependencies {
  /** Pastes the text into the window the app was called over and hides it */
  insertText: (text: string) => Promise<void>
  /** Puts the text into the clipboard; the windows stay as they are */
  copyText: (text: string) => Promise<void>
  /** Opens the chat with the text attached */
  askInChat: (text: string) => Promise<void>
  /** Opens the current chat with the text attached */
  askInCurrentChat?: (text: string) => Promise<void>
  /** Opens a new chat with the text attached */
  askInNewChat?: (text: string) => Promise<void>
  correctText: (text: string, signal: AbortSignal) => Promise<string>
  translateTo: (
    language: string,
    text: string,
    options: TranslateOptions
  ) => Promise<TransformOutput>
  transformationPrompt: (
    prompt: string,
    text: string,
    signal: AbortSignal
  ) => Promise<string>
  stylingPrompt: (
    prompt: string,
    text: string,
    signal: AbortSignal
  ) => Promise<string>
  /** Why the task cannot run on the LLM, as an i18n key */
  getLlmUnavailableReasonKey: (task: LlmTask) => string | undefined
  /** Why the translator cannot run, as an i18n key */
  getTranslatorUnavailableReasonKey: () => string | undefined
  /** A message for a failure of the LLM or the translator */
  describeError: (error: unknown) => string
}

const textOf = (call: OperationCall): string =>
  typeof call.input.text === 'string' ? call.input.text : ''

const stringOf = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : ''

const noText: OperationResult = {
  ok: false,
  level: 'warn',
  messageKey: 'toast.textNotSelected',
}

/**
 * A tool that turns the text into another one with the LLM or the translator;
 * the command decides what to do with the result
 */
function transformTool(
  deps: CoreOperationDependencies,
  tool: Omit<OperationDefinition, 'run' | 'inputSchema'>,
  transform: (
    call: OperationCall,
    text: string
  ) => Promise<string | TransformOutput> | OperationResult
): OperationDefinition {
  return {
    defaultOutputAction: 'insertIntoWindow',
    ...tool,
    inputSchema: TEXT_INPUT_SCHEMA,
    run: async (call) => {
      const text = textOf(call)
      if (!text.trim()) return noText
      try {
        const result = transform(call, text)
        if (!(result instanceof Promise)) return result
        const output = await result
        if (call.signal.aborted) return { ok: false, cancelled: true }
        const { text: content, meta } =
          typeof output === 'string'
            ? { text: output, meta: undefined }
            : output
        if (!content.trim())
          return { ok: false, messageKey: 'selection.emptyResult' }
        return meta ? { ok: true, content, meta } : { ok: true, content }
      } catch (error) {
        if (call.signal.aborted) return { ok: false, cancelled: true }
        return { ok: false, message: deps.describeError(error) }
      }
    },
  }
}

/**
 * The tools over what the app already does; they add no behavior of their own.
 * The AI command tool is made apart, see `createAiCommandOperation`
 */
export function createCoreOperations(
  deps: CoreOperationDependencies
): OperationDefinition[] {
  const insert: OperationDefinition = {
    id: 'core.insert' satisfies CoreOperationId,
    labelKey: 'operations.insert',
    descriptionKey: 'operations.insertDescription',
    icon: 'mdi:application-export',
    description:
      'Types the text into the window the user was working in, as if pasted',
    inputSchema: TEXT_INPUT_SCHEMA,
    canRunFromChat: false,
    run: async (call) => {
      const text = textOf(call)
      if (!text.trim()) return noText
      await deps.insertText(text)
      // the window is hidden already, and the text is where it shows
      return { ok: true, keepWindow: true }
    },
  }

  const copy: OperationDefinition = {
    id: 'core.copy' satisfies CoreOperationId,
    labelKey: 'operations.copy',
    descriptionKey: 'operations.copyDescription',
    icon: 'mdi:content-copy',
    description: 'Puts the text into the clipboard',
    inputSchema: TEXT_INPUT_SCHEMA,
    canRunFromChat: false,
    run: async (call) => {
      const text = textOf(call)
      if (!text.trim()) return noText
      try {
        await deps.copyText(text)
      } catch (error) {
        return { ok: false, message: deps.describeError(error) }
      }
      return { ok: true, messageKey: 'common.copied' }
    },
  }

  const askInChat: OperationDefinition = {
    id: 'core.askInChat' satisfies CoreOperationId,
    labelKey: 'operations.askInCurrentChat',
    descriptionKey: 'operations.askInCurrentChatDescription',
    icon: 'mdi:chat-question-outline',
    description: 'Opens the chat of the app with the text attached',
    inputSchema: TEXT_INPUT_SCHEMA,
    canRunFromChat: false,
    run: async (call) => {
      const text = textOf(call)
      await (deps.askInCurrentChat ?? deps.askInChat)(text)
      // the chat opens in the main window, which the quick one hands over to
      return { ok: true, keepWindow: true }
    },
  }

  const askInCurrentChat: OperationDefinition = {
    id: 'core.askInCurrentChat' satisfies CoreOperationId,
    labelKey: 'operations.askInCurrentChat',
    descriptionKey: 'operations.askInCurrentChatDescription',
    icon: 'mdi:chat-outline',
    description: 'Opens current chat with the text attached',
    inputSchema: TEXT_INPUT_SCHEMA,
    canRunFromChat: false,
    run: async (call) => {
      const text = textOf(call)
      await (deps.askInCurrentChat ?? deps.askInChat)(text)
      return { ok: true, keepWindow: true }
    },
  }

  const askInNewChat: OperationDefinition = {
    id: 'core.askInNewChat' satisfies CoreOperationId,
    labelKey: 'operations.askInNewChat',
    descriptionKey: 'operations.askInNewChatDescription',
    icon: 'mdi:chat-plus-outline',
    description: 'Opens a new chat with the text attached',
    inputSchema: TEXT_INPUT_SCHEMA,
    canRunFromChat: false,
    run: async (call) => {
      const text = textOf(call)
      await (deps.askInNewChat ?? deps.askInChat)(text)
      return { ok: true, keepWindow: true }
    },
  }

  const correct = transformTool(
    deps,
    {
      id: 'core.correct' satisfies CoreOperationId,
      labelKey: 'operations.correct',
      descriptionKey: 'operations.correctDescription',
      icon: 'mdi:spellcheck',
      description:
        'Corrects spelling, grammar and punctuation of the text with the LLM',
      getUnavailableReasonKey: () =>
        deps.getLlmUnavailableReasonKey('correction'),
    },
    (call, text) => deps.correctText(text, call.signal)
  )

  const translate = transformTool(
    deps,
    {
      id: 'core.translate' satisfies CoreOperationId,
      labelKey: 'operations.translate',
      descriptionKey: 'operations.translateDescription',
      icon: 'mdi:translate',
      description:
        'Translates the text into the language of the command or of the call; `sourceLanguage` of the config skips detecting it',
      getUnavailableReasonKey: () => deps.getTranslatorUnavailableReasonKey(),
      commandParameters: [
        {
          name: 'language',
          description: 'The language to translate into, as a BCP 47 tag',
          labelKey: 'commands.languageLabel',
          placeholderKey: 'voiceCommands.languagePlaceholder',
          voiceValuesKey: 'voiceGrammar.languages',
          valueLabelKey: getLanguageLabelKey,
        },
      ],
      voicePhrasesKey: 'voiceGrammar.translate',
    },
    (call, text) => {
      const language = parameterValue(call, 'language')
      if (!language) {
        return { ok: false, messageKey: 'commands.errorNoLanguage' }
      }
      const sourceLanguage = stringOf(call.config.sourceLanguage)
      return deps.translateTo(language, text, {
        signal: call.signal,
        ...(sourceLanguage ? { sourceLanguage } : {}),
        ...(call.onProgress ? { onStage: call.onProgress } : {}),
      })
    }
  )

  const transformation = transformTool(
    deps,
    {
      id: 'core.transformation' satisfies CoreOperationId,
      labelKey: 'operations.transformation',
      descriptionKey: 'operations.transformationDescription',
      icon: 'mdi:auto-fix',
      description:
        'Applies the transformation instruction to the text with the LLM',
      getUnavailableReasonKey: () =>
        deps.getLlmUnavailableReasonKey('transformation'),
    },
    (call, text) => {
      const prompt = stringOf(call.config.prompt)
      if (!prompt) return { ok: false, messageKey: 'commands.errorNoPrompt' }
      return deps.transformationPrompt(prompt, text, call.signal)
    }
  )

  const styling = transformTool(
    deps,
    {
      id: 'core.styling' satisfies CoreOperationId,
      labelKey: 'operations.styling',
      descriptionKey: 'operations.stylingDescription',
      icon: 'mdi:palette-outline',
      description: 'Rewrites the text in the requested style with the LLM',
      getUnavailableReasonKey: () => deps.getLlmUnavailableReasonKey('styling'),
    },
    (call, text) => {
      const prompt = stringOf(call.config.prompt)
      if (!prompt) return { ok: false, messageKey: 'commands.errorNoPrompt' }
      return deps.stylingPrompt(prompt, text, call.signal)
    }
  )

  return [
    insert,
    copy,
    correct,
    translate,
    transformation,
    styling,
    askInChat,
    askInCurrentChat,
    askInNewChat,
  ]
}
