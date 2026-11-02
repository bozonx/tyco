import {
  llmSecretId,
  resolveHotkeyTarget,
  type ActionPageConfig,
  type UserConfig,
} from '@tyco/shared'
import type { PluginFactory } from '../../types/plugins'
import { applyPluginPreset } from '../plugins/plugin-config'

export type SettingsOperations = ReturnType<typeof createSettingsOperations>

export function createSettingsOperations(deps: {
  getConfig: () => UserConfig
  pluginFactories: () => PluginFactory[]
  persist: () => Promise<unknown>
  isSaved: () => boolean
  hasSecret: (id: string) => boolean
  removeSecret: (id: string) => Promise<void>
  notifySecretError: (error: unknown) => void
}) {
  async function finishProviderRemoval(id: string) {
    await deps.persist()
    if (
      !deps.isSaved() ||
      deps.getConfig().llm.providers.some((provider) => provider.id === id)
    ) {
      return
    }
    if (deps.hasSecret(llmSecretId(id))) {
      try {
        await deps.removeSecret(llmSecretId(id))
      } catch (error) {
        deps.notifySecretError(error)
      }
    }
  }

  const updateActionPages = (pages: ActionPageConfig[]) => {
    if (pages.length === 0)
      throw new Error('At least one action page is required')
    const config = deps.getConfig()
    const normalized = pages.map((page, index) =>
      index === 0 ? { ...page, inputMode: 'selection' as const } : page
    )
    config.actionPages = normalized
  }

  const updatePluginEnabled = (pluginId: string, isEnabled: boolean) => {
    const config = deps.getConfig()
    config.plugins[pluginId] = {
      ...config.plugins[pluginId],
      settings: config.plugins[pluginId]?.settings ?? {},
      isEnabled,
    }
  }

  const updatePluginConfig = (
    pluginId: string,
    values: Record<string, unknown>
  ) => {
    const config = deps.getConfig()
    const current = config.plugins[pluginId]
    const previous = current?.settings ?? {}
    const definition = deps
      .pluginFactories()
      .find((factory) => factory().id === pluginId)?.()
    config.plugins[pluginId] = {
      ...current,
      isEnabled: current?.isEnabled ?? false,
      settings: definition
        ? applyPluginPreset(definition, previous, values)
        : { ...previous, ...values },
    }
  }

  /**
   * `id` is a hotkey id: a mode, the inline correction, or an action page, each
   * stored where it belongs
   */
  const updateHotkey = (id: string, shortcut: string) => {
    resolveHotkeyTarget(deps.getConfig(), id)?.set(shortcut)
  }

  return {
    finishProviderRemoval,
    updateActionPages,
    updateHotkey,
    updatePluginEnabled,
    updatePluginConfig,
  }
}
