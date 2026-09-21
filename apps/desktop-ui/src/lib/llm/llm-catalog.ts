import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import {
  Catalog,
  type ModelDefinitionInput,
  type ProviderFactory,
} from '@bozonx/ai-kit'
import type { LlmConfig, LlmModel, LlmProvider } from '@tyco/shared'

/** Assumed when a model does not say; the provider refuses what does not fit */
export const DEFAULT_CONTEXT_SIZE = 128_000
/**
 * The catalog's ceiling for a model's output. Only a cap: a request sends a
 * limit only when the model has one configured
 */
export const OUTPUT_TOKENS_CEILING = 65_536

/**
 * The ai-kit catalog for the user's config.
 *
 * Every model is its own catalog entry and every task a task class, its chain
 * the order of fallback. A custom endpoint is addressed by its provider id,
 * which is also the id of its key, so two local servers never share one.
 * Unfinished entries — no model name, no endpoint — are left out rather than
 * failing the whole catalog. Null when nothing is usable at all, which ai-kit
 * would refuse as an empty catalog
 */
export function buildLlmCatalog(config: LlmConfig): Catalog | null {
  const usable = usableModels(config)
  if (usable.length === 0) return null
  const usableIds = new Set(usable.map(({ model }) => model.id))

  const taskClasses = Object.fromEntries(
    Object.entries(config.tasks)
      .map(([task, chain]) => [task, chain.filter((id) => usableIds.has(id))])
      .filter(([, chain]) => chain.length > 0)
  )

  return Catalog.fromObject({
    requirePricing: false,
    models: usable.map(({ model, provider }) => toDefinition(model, provider)),
    taskClasses,
  })
}

/** Adapters for the custom endpoints, keyed by provider id */
export function buildProviderFactories(
  config: LlmConfig
): Record<string, ProviderFactory> {
  return Object.fromEntries(
    config.providers
      .filter((provider) => provider.type === 'openai-compatible')
      .map((provider): [string, ProviderFactory] => [
        provider.id,
        ({ apiKey, modelId, baseUrl, fetch }) =>
          createOpenAICompatible({
            name: provider.id,
            baseURL: baseUrl ?? provider.baseUrl ?? '',
            // A local server usually takes no key; send no header then
            ...(apiKey ? { apiKey } : {}),
            includeUsage: true,
            fetch,
          }).chatModel(modelId),
      ])
  )
}

function usableModels(config: LlmConfig) {
  const providers = new Map(
    config.providers.map((provider) => [provider.id, provider])
  )

  return config.models.flatMap((model) => {
    const provider = providers.get(model.provider)
    if (!provider || !model.model.trim()) return []
    if (provider.type === 'openai-compatible' && !isHttpUrl(provider.baseUrl)) {
      return []
    }
    return [{ model, provider }]
  })
}

function toDefinition(
  model: LlmModel,
  provider: LlmProvider
): ModelDefinitionInput {
  const custom = provider.type === 'openai-compatible'

  return {
    name: model.id,
    // Built-in providers are ai-kit's own adapters; a custom endpoint gets
    // the adapter registered under its id
    provider: custom ? provider.id : provider.type,
    model: model.model.trim(),
    ...(custom ? { baseUrl: provider.baseUrl!.trim() } : {}),
    // One tier for all: a fallback never crosses tiers, and the user's chain
    // is the whole policy
    tier: 'standard',
    contextSize: model.contextSize ?? DEFAULT_CONTEXT_SIZE,
    maxOutputTokens: Math.min(
      model.maxOutputTokens ?? OUTPUT_TOKENS_CEILING,
      OUTPUT_TOKENS_CEILING
    ),
  }
}

function isHttpUrl(value: string | undefined): boolean {
  if (!value?.trim()) return false
  try {
    const url = new URL(value.trim())
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}
