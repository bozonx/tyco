import {
  DEFAULT_USER_CONFIG,
  type SttModel,
  type SttProvider,
} from '@tyco/shared'

export interface SttConfig {
  sttModels: SttModel[]
  aiModelUsage: { stt: string }
}

/**
 * One speech model per provider: the defaults with the user's own settings for
 * that provider laid over them. Entries of unknown providers are dropped, and
 * the active model falls back to the first default when it is not one of them.
 * Mirrors `normalize_stt_config` on the Rust side.
 */
export function normalizeSttConfig(config: Record<string, any>): SttConfig {
  const existing: Record<string, any>[] = Array.isArray(config.sttModels)
    ? config.sttModels.filter(
        (model: unknown) => typeof model === 'object' && model !== null
      )
    : []

  const sttModels = DEFAULT_USER_CONFIG.sttModels.map((defaults) => {
    const own = existing.find((model) => model.provider === defaults.provider)
    return { ...defaults, ...own, id: defaults.id } as SttModel
  })

  const active = config.aiModelUsage?.stt
  const stt = sttModels.some((model) => model.id === active)
    ? (active as string)
    : sttModels[0].id

  return { sttModels, aiModelUsage: { ...config.aiModelUsage, stt } }
}

/** The model dictation uses, by the provider chosen in the settings */
export function activeSttModel(config: SttConfig): SttModel {
  return (
    config.sttModels.find((model) => model.id === config.aiModelUsage.stt) ??
    config.sttModels[0]
  )
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
    config.aiModelUsage.stt = model.id
  }
}
