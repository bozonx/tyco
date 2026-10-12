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
  send: (catalog: ToolCatalogEntry[]) => Promise<void> | void
  reportError: (error: unknown) => void
  retryMs?: number
}

/**
 * Keeps the backend catalog in step with the registry: sent once the plugins
 * have loaded, then whenever a tool comes, goes or changes its availability
 */
export function createToolCatalogSync(deps: ToolCatalogSyncDependencies) {
  let stop: (() => void) | null = null
  let desired: string | undefined
  let delivered: string | undefined
  let active = false
  let sending = false
  let generation = 0
  let retryTimer: ReturnType<typeof setTimeout> | undefined
  let failures = 0

  const flush = async () => {
    if (sending || !active) return
    sending = true
    const run = generation
    try {
      while (active && run === generation && desired !== delivered) {
        const json = desired!
        try {
          const catalog: ToolCatalogEntry[] = JSON.parse(json)
          await deps.send(catalog)
          if (run !== generation) return
          delivered = json
          failures = 0
        } catch (error) {
          if (run !== generation || !active) return
          deps.reportError(error)
          if (desired !== json) continue
          const delay = Math.min(
            (deps.retryMs ?? 1000) * 2 ** failures++,
            30000
          )
          retryTimer = setTimeout(() => {
            retryTimer = undefined
            void flush()
          }, delay)
          return
        }
      }
    } finally {
      sending = false
      if (active && run !== generation) void flush()
    }
  }

  const start = () => {
    if (active) return
    active = true
    generation++
    delivered = undefined
    failures = 0
    stop = watch(
      () => JSON.stringify(buildToolCatalog(deps.tools(), deps.t)),
      (json) => {
        desired = json
        clearTimeout(retryTimer)
        retryTimer = undefined
        void flush()
      },
      { immediate: true }
    )
    void flush()
  }

  const dispose = () => {
    active = false
    generation++
    stop?.()
    stop = null
    clearTimeout(retryTimer)
    retryTimer = undefined
  }

  return { start, dispose }
}
