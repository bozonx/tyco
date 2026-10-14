import type {
  BuiltinToolId,
  CommandConfig,
  LauncherPageConfig,
  UserConfig,
} from '@tyco/shared'
import type { PluginFactory } from '../../types/plugins'
import {
  normalizeCommands,
  normalizeLauncherCommands,
} from '../commands/command-config'
import { applyPluginPreset } from '../plugins/plugin-config'

export function createSettingsOperations(deps: {
  getConfig: () => UserConfig
  pluginFactories: () => PluginFactory[]
  createCommand: (toolId: BuiltinToolId) => CommandConfig
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

  const createLauncherCommand = (
    index: number,
    toolId: BuiltinToolId,
    page = 0
  ) => {
    const config = deps.getConfig()
    const targetPage = config.launcherPages[page]
    if (!targetPage) throw new Error('Launcher page does not exist')
    const command = deps.createCommand(toolId)
    const nextCommands = [...normalizeCommands(config.commands), command]
    const slots = normalizeLauncherCommands(
      config.launcherPages[page]?.slots,
      nextCommands
    )
    slots[index] = command.id
    config.commands = nextCommands
    targetPage.slots = slots
    return command.id
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
  return {
    finishProviderRemoval,
    updateLauncherPages,
    createLauncherCommand,
    updatePluginEnabled,
    updatePluginConfig,
  }
}
