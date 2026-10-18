import {
  type LauncherPageConfig,
  SELECTION_HOTKEY_PREFIX,
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
    if (deps.hasSecret(id)) {
      try {
        await deps.removeSecret(id)
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
    config.mainActions = config.mainActions.map((item) =>
      item?.type === 'launcherPage' && !ids.has(item.pageId) ? null : item
    )
    config.launcherPages = pages
  }

  const updatePluginEnabled = (pluginId: string, enabled: boolean) => {
    const config = deps.getConfig()
    const current = config.plugins[pluginId]
    config.plugins[pluginId] = {
      ...(current && typeof current === 'object' ? current : {}),
      enabled,
    }
  }

  const updatePluginConfig = (
    pluginId: string,
    values: Record<string, unknown>
  ) => {
    const config = deps.getConfig()
    const current = config.plugins[pluginId]
    const previous: Record<string, unknown> =
      current && typeof current === 'object'
        ? (current as Record<string, unknown>)
        : {}
    const definition = deps
      .pluginFactories()
      .find((factory) => factory().id === pluginId)?.()
    config.plugins[pluginId] = definition
      ? applyPluginPreset(definition, previous, values)
      : { ...previous, ...values }
  }
  /** A selection hotkey is stored apart from the mode hotkeys */
  const updateHotkey = (mode: string, shortcut: string) => {
    const config = deps.getConfig()
    if (mode.startsWith(SELECTION_HOTKEY_PREFIX)) {
      const action = mode.slice(SELECTION_HOTKEY_PREFIX.length)
      config.selectionHotkeys = {
        ...config.selectionHotkeys,
        [action]: shortcut,
      }
      return
    }
    config.hotkeys[mode] = shortcut
  }

  /** No path stands for the default vault location */
  const updateVaultPath = (vaultPath: string | undefined) => {
    const config = deps.getConfig()
    if (vaultPath) {
      config.aiProfiles = { ...(config.aiProfiles || {}), vaultPath }
    } else if (config.aiProfiles) {
      delete config.aiProfiles.vaultPath
    }
  }

  return {
    finishProviderRemoval,
    updateLauncherPages,
    updateHotkey,
    updateVaultPath,
    updatePluginEnabled,
    updatePluginConfig,
  }
}
