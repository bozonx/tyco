import { keepSurroundingWhitespace } from '@tyco/shared'
import type { KeyProvider, Transport } from '@bozonx/ai-kit'
import type { TranslationQualityReport } from '@bozonx/ai-kit/translate'
import type { TranslationConfig } from '@tyco/shared'

import type { LlmPrompt } from '../llm/llm-prompt'

export interface TranslationClientDependencies {
  getConfig: () => TranslationConfig
  getLlmLimits?: () => { contextWindowTokens: number; maxOutputTokens: number }
  transport: Transport
  keys: KeyProvider
  runLlm: (
    prompt: LlmPrompt,
    signal?: AbortSignal,
    options?: { onModel?: (model: { provider: string; model: string }) => void }
  ) => Promise<string>
}

export interface TranslationRunOptions {
  sourceLanguage?: string
  targetLanguage: string
  signal?: AbortSignal
  rules?: string
  /** The user rules of the review in the `always` quality gate */
  qualityGateRules?: string
  onStage?: (stage: 'translating' | 'checking' | 'repairing') => void
}

export interface TranslationRunResult {
  text: string
  provider: string
  kind: 'llm' | 'machine'
  model?: string
  detectedSourceLanguage?: string
  quality: TranslationQualityReport
}

export interface FirstPass {
  translation: string
  provider: string
  model?: string
  detectedSourceLanguage?: string
}

/**
 * A translated piece of a text cut into pieces. A cut falls after a line break
 * or a space, which the pieces keep; providers drop it from their output, and
 * the joined pieces would run together
 */
export function restoreChunkWhitespace(source: string, translated: string) {
  if (!source.trim()) return source
  return keepSurroundingWhitespace(source, translated)
}

export function normalizeLanguage(language: string): string {
  return language.trim()
}
