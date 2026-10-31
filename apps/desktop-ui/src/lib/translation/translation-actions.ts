import type { UserConfig } from '@tyco/shared'

import { LlmError, toLlmError } from '../llm/llm-client'
import type { LlmRequestErrorDependencies } from '../llm/llm-request-error'
import { TranslationError, formatTranslationError } from './translation-errors'
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
        rules: deps.getUserConfig().llm?.tasks.translation.rule,
        qualityGateRules:
          deps.getUserConfig().llm?.tasks.translation.qualityGateRule,
      })
    } catch (error) {
      if (options.signal?.aborted) return ''
      const llmError = error instanceof LlmError ? error : toLlmError(error)
      deps.logError('Translation request failed', llmError)
      if (options.notifyError !== false) {
        deps.notifyError(formatTranslationError(error, deps.translate))
      }
      throw new TranslationError(error)
    }
  }

  return { translateTo }
}
