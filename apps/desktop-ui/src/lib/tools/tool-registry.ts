import { shallowRef } from 'vue'

import type { RegisteredTool, ToolDefinition, ToolOwner } from './tool-types'

/** The full id of a plugin tool */
export function pluginToolId(pluginId: string, localId: string): string {
  return `${pluginId}.${localId}`
}

/**
 * The tools commands can run: the built-in ones of the app and those of the
 * enabled plugins (MCP tools later). Reads are reactive, so a command list
 * follows a plugin being enabled or disabled
 */
export function createToolRegistry(coreTools: readonly ToolDefinition[] = []) {
  const core: ToolOwner = { kind: 'core' }
  const tools = shallowRef<ReadonlyMap<string, RegisteredTool>>(
    new Map(coreTools.map((tool) => [tool.id, { ...tool, owner: core }]))
  )

  const set = (next: Map<string, RegisteredTool>) => {
    tools.value = next
  }

  const get = (toolId: string): RegisteredTool | undefined =>
    tools.value.get(toolId)

  const list = (): RegisteredTool[] => [...tools.value.values()]

  /** Adds tools of the app; a tool with the same id is replaced */
  const registerCoreTools = (definitions: readonly ToolDefinition[]) => {
    const next = new Map(tools.value)
    for (const tool of definitions) next.set(tool.id, { ...tool, owner: core })
    set(next)
  }

  /**
   * Adds the tools of a plugin under `<pluginId>.<id>`; `baseConfig` gives the
   * plugin settings a command falls back to
   */
  const registerPluginTools = (
    pluginId: string,
    definitions: readonly ToolDefinition[],
    baseConfig?: () => Record<string, unknown>
  ) => {
    const owner: ToolOwner = { kind: 'plugin', pluginId }
    const next = new Map(tools.value)
    for (const tool of definitions) {
      const id = pluginToolId(pluginId, tool.id)
      if (next.has(id)) throw new Error(`Duplicate tool ID: ${id}`)
      next.set(id, { ...tool, id, owner, baseConfig })
    }
    set(next)
  }

  /** Drops the tools of every plugin, before the plugins load again */
  const clearPluginTools = () => {
    set(
      new Map(
        [...tools.value].filter(([, tool]) => tool.owner.kind !== 'plugin')
      )
    )
  }

  const unregisterPlugin = (id: string) => {
    set(
      new Map(
        [...tools.value].filter(
          ([, tool]) =>
            tool.owner.kind !== 'plugin' || tool.owner.pluginId !== id
        )
      )
    )
  }

  return {
    tools,
    unregisterPlugin,
    get,
    list,
    registerCoreTools,
    registerPluginTools,
    clearPluginTools,
  }
}
