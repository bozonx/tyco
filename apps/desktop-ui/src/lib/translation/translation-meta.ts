import { isRecord } from '@tyco/shared/value-guards'
import {
  TRANSLATION_PROBLEM_CODES,
  type TranslationProblem,
  type TranslationQualityReport,
} from '@bozonx/ai-kit/translate'

import type { TranslationRunResult } from './translation-client'

/** What the preview tells about a translation: who made it and how well */
export type TranslationMeta = Pick<
  TranslationRunResult,
  'provider' | 'kind' | 'model' | 'quality'
>

function isProblem(value: unknown): value is TranslationProblem {
  return (
    isRecord(value) &&
    TRANSLATION_PROBLEM_CODES.some((code) => code === value.code) &&
    (value.detail === undefined || typeof value.detail === 'string')
  )
}

function isQuality(value: unknown): value is TranslationQualityReport {
  return (
    isRecord(value) &&
    (value.gate === 'off' ||
      value.gate === 'on_problems' ||
      value.gate === 'always') &&
    typeof value.repaired === 'boolean' &&
    (value.repairFailed === undefined ||
      typeof value.repairFailed === 'boolean') &&
    Array.isArray(value.problems) &&
    value.problems.every(isProblem) &&
    Array.isArray(value.remainingProblems) &&
    value.remainingProblems.every(isProblem)
  )
}

/** The translation facts in the `meta` of a `core.translate` result */
export function translationMetaOf(meta: unknown): TranslationMeta | undefined {
  if (!isRecord(meta) || typeof meta.provider !== 'string') return undefined
  if (meta.kind !== 'llm' && meta.kind !== 'machine') return undefined
  if (!isQuality(meta.quality)) return undefined
  return {
    provider: meta.provider,
    kind: meta.kind,
    model: typeof meta.model === 'string' ? meta.model : undefined,
    quality: meta.quality,
  }
}
