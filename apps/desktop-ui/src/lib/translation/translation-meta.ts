import type { TranslationRunResult } from './translation-client'

/** What the preview tells about a translation: who made it and how well */
export type TranslationMeta = Pick<
  TranslationRunResult,
  'provider' | 'kind' | 'model' | 'quality'
>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** The translation facts in the `meta` of a `core.translate` result */
export function translationMetaOf(meta: unknown): TranslationMeta | undefined {
  if (!isRecord(meta) || typeof meta.provider !== 'string') return undefined
  if (meta.kind !== 'llm' && meta.kind !== 'machine') return undefined
  if (!isRecord(meta.quality)) return undefined
  return {
    provider: meta.provider,
    kind: meta.kind,
    model: typeof meta.model === 'string' ? meta.model : undefined,
    quality: meta.quality as unknown as TranslationMeta['quality'],
  }
}
