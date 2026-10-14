import type {
  BuiltinToolId,
  CommandConfig,
  MainActionConfig,
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

  const updateLauncherPages = (pages: (string | null)[][]) => {
    const config = deps.getConfig()
    const previous = config.launcherPages ?? []
    if (pages.length < previous.length) {
      const removed =
        previous.findIndex((page: (string | null)[]) => !pages.includes(page)) +
        1
      config.mainActions = config.mainActions.map(
        (item: MainActionConfig | null) => {
          if (item?.type !== 'launcherPage' || item.page < removed) return item
          return item.page === removed ? null : { ...item, page: item.page - 1 }
        }
      )
      config.launcherPagesWithoutText = (config.launcherPagesWithoutText ?? [])
        .filter((page: number) => page !== removed)
        .map((page: number) => (page > removed ? page - 1 : page))
    }
    config.launcherPages = pages
  }

  const createLauncherCommand = (
    index: number,
    toolId: BuiltinToolId,
    page = 0
  ) => {
    const config = deps.getConfig()
    const command = deps.createCommand(toolId)
    const nextCommands = [...normalizeCommands(config.commands), command]
    const slots = normalizeLauncherCommands(
      page ? config.launcherPages?.[page - 1] : config.launcherCommands,
      nextCommands
    )
    slots[index] = command.id
    config.commands = nextCommands
    if (page) {
      const pages = [...(config.launcherPages ?? [])]
      pages[page - 1] = slots
      config.launcherPages = pages
    } else config.launcherCommands = slots
    return command.id
  }

  const updatePluginEnabled = (pluginName: string, enabled: boolean) => {
    const config = deps.getConfig()
    const current = config.plugins[pluginName]
    config.plugins[pluginName] = {
      ...(current && typeof current === 'object' ? current : {}),
      enabled,
    }
  }

  const updatePluginConfig = (
    pluginName: string,
    values: Record<string, unknown>
  ) => {
    const config = deps.getConfig()
    const current = config.plugins[pluginName]
    const previous: Record<string, unknown> =
      current && typeof current === 'object'
        ? (current as Record<string, unknown>)
        : {}
    const definition = deps
      .pluginFactories()
      .find((factory) => factory().id === pluginName)?.()
    config.plugins[pluginName] = definition
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
