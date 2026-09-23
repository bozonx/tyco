import {
  BUILTIN_LLM_PROVIDERS,
  DEFAULT_LLM_CONFIG,
  LLM_TASKS,
  type LlmConfig,
  type LlmModel,
  type LlmProvider,
  type LlmProviderType,
  type LlmTask,
} from '@tyco/shared'

const PROVIDER_TYPES: readonly LlmProviderType[] = [
  'google',
  'openrouter',
  'deepseek',
  'openai-compatible',
]

/** Provider ids double as secret ids, so they follow the secret id rules */
const ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/

export function isBuiltinProvider(id: string): boolean {
  return (BUILTIN_LLM_PROVIDERS as readonly string[]).includes(id)
}

export function isValidLlmId(id: unknown): id is string {
  return typeof id === 'string' && ID_PATTERN.test(id)
}

/**
 * Brings whatever the config file holds into a shape the rest of the app can
 * trust. Tolerant of half-edited values: an empty model name survives, so a
 * field being typed into is not wiped out
 */
export function normalizeLlmConfig(raw: unknown): LlmConfig {
  const source = isRecord(raw) ? raw : {}
  const providers = normalizeProviders(source.providers)
  const models = normalizeModels(source.models, providers)
  const tasks = normalizeTasks(source.tasks, models)

  return { providers, models, tasks }
}

function normalizeProviders(raw: unknown): LlmProvider[] {
  const result: LlmProvider[] = []
  const seen = new Set<string>()

  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isRecord(item) || !isValidLlmId(item.id) || seen.has(item.id)) {
      continue
    }
    const type = item.type as LlmProviderType
    if (!PROVIDER_TYPES.includes(type)) continue
    // A built-in provider is its type; a custom endpoint may not take its id
    if (isBuiltinProvider(item.id) !== (type !== 'openai-compatible')) continue
    if (isBuiltinProvider(item.id) && item.id !== type) continue

    const provider: LlmProvider = { id: item.id, type }
    if (typeof item.name === 'string') provider.name = item.name
    if (type === 'openai-compatible') {
      provider.baseUrl = typeof item.baseUrl === 'string' ? item.baseUrl : ''
    }
    seen.add(item.id)
    result.push(provider)
  }

  const builtins = DEFAULT_LLM_CONFIG.providers
    .filter((provider) => isBuiltinProvider(provider.id))
    .map(
      (provider) =>
        result.find((item) => item.id === provider.id) ?? { ...provider }
    )

  return [
    ...builtins,
    ...result.filter((provider) => !isBuiltinProvider(provider.id)),
  ]
}

function normalizeModels(raw: unknown, providers: LlmProvider[]): LlmModel[] {
  const providerIds = new Set(providers.map((provider) => provider.id))
  const result: LlmModel[] = []
  const seen = new Set<string>()

  for (const item of Array.isArray(raw) ? raw : []) {
    if (!isRecord(item) || typeof item.id !== 'string') continue
    const id = item.id.trim()
    if (!id || seen.has(id)) continue
    if (typeof item.provider !== 'string' || !providerIds.has(item.provider)) {
      continue
    }

    const model: LlmModel = {
      id,
      provider: item.provider,
      model: typeof item.model === 'string' ? item.model : '',
    }
    if (typeof item.name === 'string') model.name = item.name
    const temperature = finiteNumber(item.temperature)
    if (temperature !== undefined && temperature >= 0 && temperature <= 2) {
      model.temperature = temperature
    }
    const maxOutputTokens = positiveInteger(item.maxOutputTokens)
    if (maxOutputTokens !== undefined) model.maxOutputTokens = maxOutputTokens
    const contextSize = positiveInteger(item.contextSize)
    if (contextSize !== undefined) model.contextSize = contextSize

    seen.add(id)
    result.push(model)
  }

  return result
}

function normalizeTasks(
  raw: unknown,
  models: LlmModel[]
): Record<LlmTask, string[]> {
  const source = isRecord(raw) ? raw : {}
  const modelIds = new Set(models.map((model) => model.id))

  return Object.fromEntries(
    LLM_TASKS.map((task) => {
      const chain = Array.isArray(source[task]) ? source[task] : []
      const ids = [
        ...new Set(
          chain.filter(
            (id): id is string => typeof id === 'string' && modelIds.has(id)
          )
        ),
      ]
      return [task, ids]
    })
  ) as Record<LlmTask, string[]>
}

/** A fresh id that is not in `taken`: `prefix`, then `prefix-2`, `prefix-3`… */
export function uniqueLlmId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  if (!used.has(prefix)) return prefix

  for (let index = 2; ; index += 1) {
    const candidate = `${prefix}-${index}`
    if (!used.has(candidate)) return candidate
  }
}

export function addCompatibleProvider(config: LlmConfig): LlmProvider {
  const provider: LlmProvider = {
    id: uniqueLlmId(
      'local',
      config.providers.map((item) => item.id)
    ),
    type: 'openai-compatible',
    name: '',
    baseUrl: '',
  }
  config.providers.push(provider)
  return provider
}

/** Removes a custom provider together with its models */
export function removeProvider(config: LlmConfig, providerId: string) {
  if (isBuiltinProvider(providerId)) return

  config.providers = config.providers.filter(
    (provider) => provider.id !== providerId
  )
  const removed = config.models
    .filter((model) => model.provider === providerId)
    .map((model) => model.id)
  removed.forEach((modelId) => removeModel(config, modelId))
}

export function addModel(config: LlmConfig, providerId: string): LlmModel {
  const model: LlmModel = {
    id: uniqueLlmId(
      `${providerId}-model`,
      config.models.map((item) => item.id)
    ),
    provider: providerId,
    model: '',
    name: '',
  }
  config.models.push(model)
  return model
}

/** Removes a model and every place a task used it */
export function removeModel(config: LlmConfig, modelId: string) {
  config.models = config.models.filter((model) => model.id !== modelId)

  for (const task of LLM_TASKS) {
    config.tasks[task] = config.tasks[task].filter((id) => id !== modelId)
  }
}

export function modelLabel(model: LlmModel): string {
  return model.name?.trim() || model.model.trim() || model.id
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function positiveInteger(value: unknown): number | undefined {
  const parsed = finiteNumber(value)
  return parsed !== undefined && parsed > 0 ? Math.round(parsed) : undefined
}
