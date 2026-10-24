import {
  BUILTIN_LLM_PROVIDERS,
  LLM_TASKS,
  normalizeLlmConfig,
  type LlmConfig,
  type LlmModel,
  type LlmProvider,
  type LlmTask,
} from '@tyco/shared'

export { normalizeLlmConfig }

function isBuiltinProvider(id: string): boolean {
  return (BUILTIN_LLM_PROVIDERS as readonly string[]).includes(id)
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
    id: `custom-${crypto.randomUUID()}`,
    type: 'openaiCompatible',
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
    .filter((model) => model.providerId === providerId)
    .map((model) => model.id)
  removed.forEach((modelId) => removeModel(config, modelId))
}

/**
 * A new model of a custom endpoint starts without tools: local models often
 * cannot call them
 */
export function addModel(config: LlmConfig, providerId: string): LlmModel {
  const provider = config.providers.find((item) => item.id === providerId)
  const model: LlmModel = {
    id: uniqueLlmId(
      `${providerId}-model`,
      config.models.map((item) => item.id)
    ),
    providerId: providerId,
    providerModelId: '',
    name: '',
    canUseImages: false,
    canUseTools: provider?.type !== 'openaiCompatible',
  }
  config.models.push(model)
  return model
}

/** Removes a model and every place a task used it */
export function removeModel(config: LlmConfig, modelId: string) {
  config.models = config.models.filter((model) => model.id !== modelId)

  for (const task of LLM_TASKS) {
    if (config.tasks[task].modelId === modelId) config.tasks[task].modelId = ''
  }
}

export function modelLabel(
  model: Pick<LlmModel, 'id' | 'name' | 'providerModelId'>
): string {
  return model.name?.trim() || model.providerModelId.trim() || model.id
}

/** The model a task answers with, undefined when none is picked */
export function taskModel(
  config: Pick<LlmConfig, 'models' | 'tasks'>,
  task: LlmTask
): LlmModel | undefined {
  const { modelId } = config.tasks[task]
  return modelId
    ? config.models.find((model) => model.id === modelId)
    : undefined
}
