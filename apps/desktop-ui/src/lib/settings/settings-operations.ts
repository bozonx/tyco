import {
  llmSecretId,
  resolveHotkeyTarget,
  type LauncherPageConfig,
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

  const updateLauncherPages = (pages: LauncherPageConfig[]) => {
    if (pages.length === 0)
      throw new Error('At least one launcher page is required')
    const config = deps.getConfig()
    const ids = new Set(pages.map((page) => page.id))
    config.mainActions = Object.fromEntries(
      Object.entries(config.mainActions).filter(
        ([, item]) => item.type !== 'launcherPage' || ids.has(item.pageId)
      )
    )
    config.launcherPages = pages
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
   * `id` is a hotkey id: a mode, the inline correction, or a page of the
   * command overlay, each stored where it belongs
   */
  const updateHotkey = (id: string, shortcut: string) => {
    resolveHotkeyTarget(deps.getConfig(), id)?.set(shortcut)
  }

  return {
    finishProviderRemoval,
    updateLauncherPages,
    updateHotkey,
    updatePluginEnabled,
    updatePluginConfig,
  }
}
