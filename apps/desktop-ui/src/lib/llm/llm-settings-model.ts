import { reactive } from 'vue'

import {
  llmSecretId,
  type LlmConfig,
  type LlmModel,
  type LlmProvider,
} from '@tyco/shared'

import { createSecretKeyEditor } from '../settings/secret-key-editor'
import { httpOrigin } from '../net/secrets'
import {
  addCompatibleProvider,
  createModel,
  removeProvider,
} from './llm-config'
import { InvalidLlmBaseUrlError } from './llm-connection'
import { parseModelTemperature, parseModelTokenCount } from './model-number'

export type LlmConnectionCheckStatus = 'checking' | 'success' | 'error'

export function createLlmSettingsModel(deps: {
  getConfig: () => LlmConfig
  setSecret: (id: string, value: string, origins?: string[]) => Promise<void>
  removeSecret: (id: string) => Promise<void>
  checkConnection: (provider: LlmProvider) => Promise<unknown>
  notifyKeyError: (error: unknown) => void
  notifyInvalidUrl: () => void
  formatConnectionError: (error: unknown) => string
  providerRemoved: (id: string) => void
}) {
  const keyDrafts = reactive<Record<string, string>>({})
  const expandedProviderIds = reactive(new Set<string>())
  const expandedModelIds = reactive(new Set<string>())
  /** New models that wait for an id; the config gets a model only with one */
  const draftModels = reactive<LlmModel[]>([])
  const connectionCheckStatusByProviderId = reactive<
    Partial<Record<string, LlmConnectionCheckStatus>>
  >({})
  const connectionErrors = reactive<Record<string, string>>({})
  const numberDrafts = reactive<Record<string, string>>({})
  const numberErrors = reactive<Record<string, boolean>>({})
  const requests = new Map<string, symbol>()

  function clearConnectionCheck(id: string) {
    requests.delete(id)
    delete connectionCheckStatusByProviderId[id]
    delete connectionErrors[id]
  }
  const keyEditor = (id: string) =>
    createSecretKeyEditor({
      getSecretId: () =>
        deps.getConfig().providers.some((provider) => provider.id === id)
          ? llmSecretId(id)
          : undefined,
      getDraft: () => keyDrafts[id] ?? '',
      setDraft: (value) => {
        keyDrafts[id] = value
      },
      setSecret: deps.setSecret,
      removeSecret: deps.removeSecret,
      reportError: deps.notifyKeyError,
      onSaved: () => clearConnectionCheck(id),
      onRemoved: () => clearConnectionCheck(id),
    })
  async function saveKey(provider: LlmProvider) {
    if (!keyDrafts[provider.id]?.trim()) return
    const origin =
      provider.type === 'openaiCompatible' ? httpOrigin(provider.baseUrl) : null
    if (provider.type === 'openaiCompatible' && !origin) {
      deps.notifyInvalidUrl()
      return
    }
    await keyEditor(provider.id).save(origin ? [origin] : undefined)
  }
  const removeKey = (id: string) => keyEditor(id).remove()
  function addProvider() {
    const provider = addCompatibleProvider(deps.getConfig())
    expandedProviderIds.add(provider.id)
  }
  function removeProviderById(id: string) {
    removeProvider(deps.getConfig(), id)
    expandedProviderIds.delete(id)
    requests.delete(id)
    delete keyDrafts[id]
    delete connectionCheckStatusByProviderId[id]
    delete connectionErrors[id]
    discardDrafts((model) => model.providerId === id)
    deps.providerRemoved(id)
  }
  function discardDrafts(isDiscarded: (model: LlmModel) => boolean) {
    for (let index = draftModels.length - 1; index >= 0; index -= 1) {
      const model = draftModels[index]
      if (!isDiscarded(model)) continue
      draftModels.splice(index, 1)
      expandedModelIds.delete(model.id)
      for (const key of Object.keys(numberDrafts)) {
        if (key.startsWith(`${model.id}:`)) delete numberDrafts[key]
      }
      for (const key of Object.keys(numberErrors)) {
        if (key.startsWith(`${model.id}:`)) delete numberErrors[key]
      }
    }
  }
  function addModelToProvider(providerId: string) {
    const model = createModel(
      deps.getConfig(),
      providerId,
      draftModels.map((item) => item.id)
    )
    draftModels.unshift(model)
    expandedModelIds.add(model.id)
  }
  const isDraftModel = (id: string) =>
    draftModels.some((model) => model.id === id)
  /** The drafts of a provider first, then its saved models */
  function modelsOf(providerId: string): LlmModel[] {
    return [...draftModels, ...deps.getConfig().models].filter(
      (model) => model.providerId === providerId
    )
  }
  /** Saves a draft with all its fields once its id gets a character */
  function updateModel(model: LlmModel, patch: Partial<LlmModel>) {
    Object.assign(model, patch)
    const index = draftModels.findIndex((item) => item.id === model.id)
    if (index < 0 || !model.providerModelId.trim()) return
    const [draft] = draftModels.splice(index, 1)
    deps.getConfig().models.unshift(draft)
  }
  const discardDraftModel = (id: string) =>
    discardDrafts((model) => model.id === id)
  async function checkConnection(provider: LlmProvider) {
    const request = Symbol()
    requests.set(provider.id, request)
    connectionCheckStatusByProviderId[provider.id] = 'checking'
    delete connectionErrors[provider.id]
    try {
      await deps.checkConnection({ ...provider })
      if (requests.get(provider.id) === request)
        connectionCheckStatusByProviderId[provider.id] = 'success'
    } catch (error) {
      if (requests.get(provider.id) !== request) return
      if (error instanceof InvalidLlmBaseUrlError) {
        delete connectionCheckStatusByProviderId[provider.id]
        deps.notifyInvalidUrl()
      } else {
        connectionCheckStatusByProviderId[provider.id] = 'error'
        connectionErrors[provider.id] = deps.formatConnectionError(error)
      }
    }
  }
  function setNumber(
    model: LlmModel,
    field: 'temperature' | 'maxOutputTokens' | 'contextWindowTokens',
    value: string
  ) {
    const key = `${model.id}:${field}`
    numberDrafts[key] = value
    const parsed =
      field === 'temperature'
        ? parseModelTemperature(value)
        : parseModelTokenCount(value)
    if (parsed.isValid && parsed.value === undefined) {
      delete model[field]
      delete numberErrors[key]
      return
    }
    numberErrors[key] = !parsed.isValid
    if (parsed.isValid) model[field] = parsed.value
  }
  function dispose() {
    requests.clear()
    discardDrafts(() => true)
  }
  return {
    keyDrafts,
    expandedProviderIds,
    expandedModelIds,
    connectionCheckStatusByProviderId,
    connectionErrors,
    numberDrafts,
    numberErrors,
    saveKey,
    removeKey,
    addProvider,
    removeProviderById,
    addModelToProvider,
    isDraftModel,
    modelsOf,
    updateModel,
    discardDraftModel,
    checkConnection,
    setNumber,
    dispose,
  }
}
