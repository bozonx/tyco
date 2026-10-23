import type { ChatLlmOption } from '../chat/chat-llm-selection'

export interface ProfileModelOption {
  id: string
  name: string
  group?: string
}

/** The select value of an unset model: the first usable one */
export const DEFAULT_PROFILE_MODEL_OPTION = ''

type Translate = (key: string, params?: Record<string, string>) => string

function unavailableModelName(modelId: string, t: Translate): string {
  return `${modelId} (${t('settings.profileModelUnavailable')})`
}

/**
 * The models a profile may pick: the default first, named after the model it
 * stands for, then the usable ones by provider. A picked model that was removed
 * or lost its key stays on the list as unavailable
 */
export function profileModelOptions(
  models: ChatLlmOption[],
  modelId: string | undefined,
  t: Translate
): ProfileModelOption[] {
  const firstModel = models[0]
  const options: ProfileModelOption[] = [
    {
      id: DEFAULT_PROFILE_MODEL_OPTION,
      name: firstModel
        ? t('settings.profileModelDefaultNamed', { model: firstModel.name })
        : t('settings.profileModelDefault'),
    },
    ...models.map((option) => ({
      id: option.id,
      name: option.name,
      group: option.providerLabel,
    })),
  ]
  if (modelId && !models.some((model) => model.id === modelId))
    options.push({ id: modelId, name: unavailableModelName(modelId, t) })
  return options
}

/** The name of the model a profile answers with, as the overview shows it */
export function profileModelName(
  models: ChatLlmOption[],
  modelId: string | undefined,
  t: Translate
): string {
  if (!modelId) return t('settings.profileModelDefault')
  return (
    models.find((model) => model.id === modelId)?.name ??
    unavailableModelName(modelId, t)
  )
}
