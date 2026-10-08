import { watch } from 'vue'

import type { ToolCatalogEntry } from '@tyco/shared'

import { schemaShape } from './tool-input'
import type { RegisteredTool } from './tool-types'

/** The tools as the backend checks external calls against them */
export function buildToolCatalog(
  tools: readonly RegisteredTool[],
  t: (key: string) => string
): ToolCatalogEntry[] {
  return tools.map((tool) => {
    const shape = schemaShape(tool.inputSchema)
    const reason = tool.unavailableReason?.()
    const entry: ToolCatalogEntry = {
      id: tool.id,
      input:
        shape !== 'structured'
          ? shape
          : tool.parseText
            ? 'parsed'
            : 'structured',
      available: !reason,
      inputSchema: tool.inputSchema,
    }
    if (reason) entry.reason = t(reason)
    return entry
  })
}

export interface ToolCatalogSyncDependencies {
  tools: () => readonly RegisteredTool[]
  t: (key: string) => string
  send: (catalog: ToolCatalogEntry[]) => Promise<unknown> | void
}

/**
 * Keeps the backend catalog in step with the registry: sent once the plugins
 * have loaded, then whenever a tool comes, goes or changes its availability
 */
export function createToolCatalogSync(deps: ToolCatalogSyncDependencies) {
  let stop: (() => void) | null = null

  const start = () => {
    if (stop) return
    stop = watch(
      () => JSON.stringify(buildToolCatalog(deps.tools(), deps.t)),
      (json) => {
        void Promise.resolve(deps.send(JSON.parse(json))).catch(() => {})
      },
      { immediate: true }
    )
  }

  const dispose = () => {
    stop?.()
    stop = null
  }

  return { start, dispose }
}
