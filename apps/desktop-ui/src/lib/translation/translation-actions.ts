import type { UserConfig } from '@tyco/shared'

import {
  handleLlmRequestError,
  type LlmRequestErrorDependencies,
} from '../llm/llm-request-error'
import type { createTranslationClient } from './translation-client'

export interface TranslateActionOptions {
  signal?: AbortSignal
  onStage?: (stage: 'translating' | 'checking' | 'repairing') => void
  notifyError?: boolean
  /** Detected by the translator when omitted */
  sourceLanguage?: string
}

export interface TranslationActionsDependencies extends LlmRequestErrorDependencies {
  client: Pick<ReturnType<typeof createTranslationClient>, 'translate'>
  getUserConfig: () => UserConfig
  notifyEmptyText: () => void
}

export function createTranslationActions(deps: TranslationActionsDependencies) {
  /** Translates into any language, not only the configured ones */
  const translateTo = async (
    targetLanguage: string,
    text?: string,
    options: TranslateActionOptions = {}
  ) => {
    if (!text?.trim()) {
      deps.notifyEmptyText()
      return ''
    }

    try {
      return await deps.client.translate(text, {
        targetLanguage,
        sourceLanguage: options.sourceLanguage,
        signal: options.signal,
        onStage: options.onStage,
        rules: deps.getUserConfig().aiRules?.translation,
        qualityGateRules: deps.getUserConfig().aiRules?.translationQualityGate,
      })
    } catch (error) {
      return handleLlmRequestError(
        error,
        'Translation request failed',
        options,
        deps
      )
    }
  }

  return { translateTo }
}
