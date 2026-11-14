import { shallowRef } from 'vue'

import type {
  RegisteredOperation,
  OperationDefinition,
  OperationOwner,
} from './operation-types'

/** The full id of a plugin tool */
export function pluginOperationId(pluginId: string, localId: string): string {
  return `${pluginId}.${localId}`
}

/**
 * The tools commands can run: the built-in ones of the app and those of the
 * enabled plugins (MCP tools later). Reads are reactive, so a command list
 * follows a plugin being enabled or disabled
 */
export function createOperationRegistry(
  coreOperations: readonly OperationDefinition[] = []
) {
  const core: OperationOwner = { kind: 'core' }
  const tools = shallowRef<ReadonlyMap<string, RegisteredOperation>>(
    new Map(coreOperations.map((tool) => [tool.id, { ...tool, owner: core }]))
  )

  const set = (next: Map<string, RegisteredOperation>) => {
    tools.value = next
  }

  const get = (operationId: string): RegisteredOperation | undefined =>
    tools.value.get(operationId)

  const list = (): RegisteredOperation[] =>
    [...tools.value.values()].sort((left, right) => {
      const a = left.owner.kind === 'plugin' ? left.owner.pluginId : ''
      const b = right.owner.kind === 'plugin' ? right.owner.pluginId : ''
      return a < b ? -1 : a > b ? 1 : 0
    })

  /** Adds tools of the app; a tool with the same id is replaced */
  const registerCoreOperations = (
    definitions: readonly OperationDefinition[]
  ) => {
    const next = new Map(tools.value)
    for (const tool of definitions) next.set(tool.id, { ...tool, owner: core })
    set(next)
  }

  /**
   * Adds the tools of a plugin under `<pluginId>.<id>`; `baseConfig` gives the
   * plugin settings a command falls back to
   */
  const registerPluginOperations = (
    pluginId: string,
    definitions: readonly OperationDefinition[],
    baseConfig?: () => Record<string, unknown>
  ) => {
    const owner: OperationOwner = { kind: 'plugin', pluginId }
    const next = new Map(tools.value)
    for (const tool of definitions) {
      const id = pluginOperationId(pluginId, tool.id)
      if (next.has(id)) throw new Error(`Duplicate tool ID: ${id}`)
      next.set(id, { ...tool, id, owner, baseConfig })
    }
    set(next)
    return () => {
      const remaining = new Map(tools.value)
      for (const definition of definitions) {
        const id = pluginOperationId(pluginId, definition.id)
        if (remaining.get(id) === next.get(id)) remaining.delete(id)
      }
      set(remaining)
    }
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
    registerCoreOperations,
    registerPluginOperations,
  }
}
