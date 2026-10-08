import { shallowRef } from 'vue'

import type { RegisteredTool, ToolDefinition, ToolOwner } from './tool-types'

/** The full id of a plugin tool */
export function pluginToolId(pluginName: string, localId: string): string {
  return `${pluginName}.${localId}`
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
   * Adds the tools of a plugin under `<pluginName>.<id>`; `baseConfig` gives
   * the plugin settings a command falls back to
   */
  const registerPluginTools = (
    pluginName: string,
    definitions: readonly ToolDefinition[],
    baseConfig?: () => Record<string, unknown>
  ) => {
    const owner: ToolOwner = { kind: 'plugin', name: pluginName }
    const next = new Map(tools.value)
    for (const tool of definitions) {
      const id = pluginToolId(pluginName, tool.id)
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
          ([, tool]) => tool.owner.kind !== 'plugin' || tool.owner.name !== id
        )
      )
    )
  }

  return {
    unregisterPlugin,
    get,
    list,
    registerCoreTools,
    registerPluginTools,
    clearPluginTools,
  }
}

export type ToolRegistry = ReturnType<typeof createToolRegistry>
