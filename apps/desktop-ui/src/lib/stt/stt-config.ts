import {
  DEFAULT_USER_CONFIG,
  type SttModel,
  type SttProvider,
} from '@tyco/shared'

export interface SttConfig {
  sttModels: SttModel[]
  selectedSttModelId: string
}

/**
 * One speech model per provider: the defaults with the user's own settings for
 * that provider laid over them. Entries of unknown providers are dropped, and
 * the active model falls back to the first default when it is not one of them.
 * Mirrors `normalize_stt_config` on the Rust side.
 */
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

export function normalizeSttConfig(value: unknown): SttConfig {
  const config = isRecord(value) ? value : {}
  const existing: unknown[] = Array.isArray(config.sttModels)
    ? config.sttModels
    : []
  const sttModels = DEFAULT_USER_CONFIG.sttModels.map((defaults): SttModel => {
    const own = existing.find(
      (model): model is Record<string, unknown> =>
        isRecord(model) && model.provider === defaults.provider
    )
    const model = { ...defaults }
    if (!own) return model
    if (typeof own.providerModelId === 'string')
      model.providerModelId = own.providerModelId
    if (typeof own.description === 'string') model.description = own.description
    if (typeof own.language === 'string') model.language = own.language
    if (typeof own.baseUrl === 'string') model.baseUrl = own.baseUrl
    if (typeof own.formatWithLlm === 'boolean')
      model.formatWithLlm = own.formatWithLlm
    return model
  })
  const active = config.selectedSttModelId
  const first = sttModels[0]
  if (!first) throw new Error('No default speech model is configured')
  const stt =
    typeof active === 'string' && sttModels.some((model) => model.id === active)
      ? active
      : first.id
  return { sttModels, selectedSttModelId: stt }
}

/** The model dictation uses, by the provider chosen in the settings */
export function activeSttModel(config: SttConfig): SttModel {
  const model =
    config.sttModels.find((item) => item.id === config.selectedSttModelId) ??
    config.sttModels[0]
  if (!model) throw new Error('No speech model is configured')
  return model
}

/** Makes the model of `provider` the one dictation uses */
export function selectSttProvider(
  config: SttConfig,
  provider: SttProvider
): void {
  const current = activeSttModel(config)
  const formatWithLlm = current?.formatWithLlm
  const model = config.sttModels.find((item) => item.provider === provider)
  if (model) {
    if (formatWithLlm !== undefined) {
      model.formatWithLlm = formatWithLlm
    }
    config.selectedSttModelId = model.id
  }
}
