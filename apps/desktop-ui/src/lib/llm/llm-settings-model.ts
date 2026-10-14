import { reactive } from 'vue'

import type { LlmConfig, LlmModel, LlmProvider, LlmTask } from '@tyco/shared'

import { httpOrigin } from '../net/secrets'
import { addCompatibleProvider, addModel, removeProvider } from './llm-config'
import { InvalidLlmBaseUrlError } from './llm-connection'

export type LlmConnectionCheckStatus = 'checking' | 'success' | 'error'

export function createLlmSettingsModel(deps: {
  getConfig: () => LlmConfig
  getUsableModelIds: () => string[]
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
  const connectionCheckStatusByProviderId = reactive<
    Partial<Record<string, LlmConnectionCheckStatus>>
  >({})
  const connectionErrors = reactive<Record<string, string>>({})
  const numberDrafts = reactive<Record<string, string>>({})
  const numberErrors = reactive<Record<string, boolean>>({})
  const requests = new Map<string, symbol>()

  async function saveKey(provider: LlmProvider) {
    const value = keyDrafts[provider.id]?.trim()
    if (!value) return
    const origin =
      provider.type === 'openai-compatible'
        ? httpOrigin(provider.baseUrl)
        : null
    if (provider.type === 'openai-compatible' && !origin) {
      deps.notifyInvalidUrl()
      return
    }
    try {
      await deps.setSecret(provider.id, value, origin ? [origin] : undefined)
      requests.delete(provider.id)
      keyDrafts[provider.id] = ''
      delete connectionCheckStatusByProviderId[provider.id]
      delete connectionErrors[provider.id]
    } catch (error) {
      deps.notifyKeyError(error)
    }
  }
  async function removeKey(id: string) {
    try {
      await deps.removeSecret(id)
      requests.delete(id)
      delete connectionCheckStatusByProviderId[id]
      delete connectionErrors[id]
    } catch (error) {
      deps.notifyKeyError(error)
    }
  }
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
    deps.providerRemoved(id)
  }
  function addModelToProvider(providerId: string) {
    const model = addModel(deps.getConfig(), providerId)
    expandedModelIds.add(model.id)
  }
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
    if (value.trim() === '') {
      delete model[field]
      delete numberErrors[key]
      return
    }
    const parsed = Number(value)
    const invalid =
      !Number.isFinite(parsed) ||
      (field === 'temperature'
        ? parsed < 0 || parsed > 2
        : parsed < 1 || !Number.isSafeInteger(parsed))
    numberErrors[key] = invalid
    if (!invalid) model[field] = parsed
  }
  function nextFallback(task: LlmTask) {
    const usable = new Set(deps.getUsableModelIds())
    const config = deps.getConfig()
    return config.models.find(
      (model) => usable.has(model.id) && !config.tasks[task].includes(model.id)
    )
  }
  function addFallback(task: LlmTask) {
    const model = nextFallback(task)
    if (model) deps.getConfig().tasks[task].push(model.id)
  }
  function dispose() {
    requests.clear()
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
    checkConnection,
    setNumber,
    nextFallback,
    addFallback,
    dispose,
  }
}
