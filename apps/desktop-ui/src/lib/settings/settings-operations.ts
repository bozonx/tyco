import {
  type HotkeyId,
  INLINE_CORRECTION_HOTKEY_ID,
  LAUNCHER_PAGE_HOTKEY_PREFIX,
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
    const config = deps.getConfig()
    if (id === INLINE_CORRECTION_HOTKEY_ID) {
      config.hotkeys.selectionCorrection = shortcut
      return
    }
    if (id.startsWith(LAUNCHER_PAGE_HOTKEY_PREFIX)) {
      const pageId = id.slice(LAUNCHER_PAGE_HOTKEY_PREFIX.length)
      const page = config.launcherPages.find((item) => item.id === pageId)
      if (page) page.hotkey = shortcut
      return
    }
    if (Object.hasOwn(config.hotkeys, id))
      config.hotkeys[id as HotkeyId] = shortcut
  }

  /** No path stands for the default vault location */
  const updateVaultPath = (path: string | undefined) => {
    const config = deps.getConfig()
    config.aiVault = path ? { path } : {}
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
