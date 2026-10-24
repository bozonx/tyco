import { errorMessage } from '@tyco/shared/value-guards'
import {
  RESERVED_PLUGIN_ID,
  clonePluginValue,
  hasPluginIdFormat,
} from '@tyco/plugin-sdk'
import {
  pluginManifest,
  type PluginCapability,
  type PluginContext,
} from '@tyco/plugin-sdk'

import type { PluginFactory } from '../../types/plugins'
import { getPluginState, pluginId, resolvePluginConfig } from './plugin-config'

/** Time limits of a plugin's code, unless told otherwise */
const DEFAULT_CLEANUP_TIMEOUT_MS = 2000
const DEFAULT_ACTIVATION_TIMEOUT_MS = 10_000

export interface PluginLifecycle {
  signal: AbortSignal
  capabilities: readonly PluginCapability[]
  iconPrefix?: string
  configPresets?: Record<string, Record<string, object>>
  notesDirectoryField?: string
  onDispose(cleanup: () => void | Promise<void>): void
}
export interface PluginRuntimeState {
  status: 'disabled' | 'activating' | 'active' | 'error' | 'incompatible'
  error?: string
}
export interface PluginManagerDependencies {
  activationTimeoutMs?: number
  cleanupTimeoutMs?: number
  onStateChange?(id: string, state: PluginRuntimeState): void

  pluginFactories: PluginFactory[]
  createPluginContext(
    id: string,
    config: () => Record<string, unknown>,
    lifecycle: PluginLifecycle
  ): PluginContext
  unregisterPlugin(id: string): void
  registerResources?(plugin: ReturnType<PluginFactory>): void
  reportError?(id: string, error: unknown): void
}
interface ActivePlugin {
  signature: string
  initializing: boolean
  controller: AbortController
  cleanups: Array<() => void | Promise<void>>
}

export function createPluginManager(deps: PluginManagerDependencies) {
  const active = new Map<string, ActivePlugin>()
  let revision = 0
  let pending = Promise.resolve()
  let disposed = false
  const runtimeStates = new Map<string, PluginRuntimeState>()
  const setState = (id: string, state: PluginRuntimeState) => {
    runtimeStates.set(id, state)
    deps.onStateChange?.(id, state)
  }
  const report = (id: string, error: unknown) => deps.reportError?.(id, error)
  async function bounded<T>(
    work: Promise<T>,
    timeoutMs: number,
    message: string
  ): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(message)), timeoutMs)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
  }
  /** Runs a cleanup of the plugin `id` within its time limit; reports a failure */
  async function runCleanup(id: string, cleanup: () => unknown) {
    try {
      await bounded(
        Promise.resolve().then(cleanup),
        deps.cleanupTimeoutMs ?? DEFAULT_CLEANUP_TIMEOUT_MS,
        'Plugin cleanup timed out'
      )
    } catch (error) {
      report(id, error)
    }
  }
  const isPluginEnabled = (
    id: string,
    userConfig?: { plugins?: Record<string, unknown> }
  ) => {
    const state = userConfig?.plugins?.[id]
    return Boolean(
      state &&
      typeof state === 'object' &&
      'isEnabled' in state &&
      state.isEnabled === true
    )
  }
  async function deactivate(id: string) {
    const instance = active.get(id)
    if (!instance) return
    active.delete(id)
    instance.controller.abort()
    deps.unregisterPlugin(id)
    for (const cleanup of instance.cleanups.reverse())
      await runCleanup(id, cleanup)
  }
  function loadPlugins(userConfig?: { plugins?: Record<string, unknown> }) {
    if (disposed) return Promise.resolve()
    for (const instance of active.values())
      if (instance.initializing) instance.controller.abort()
    const requested = ++revision
    const states = clonePluginValue(userConfig?.plugins ?? {})
    pending = pending
      .then(async () => {
        if (requested !== revision || disposed) return
        const definitions = new Map<string, ReturnType<PluginFactory>>()
        const duplicates = new Set<string>()
        for (const factory of deps.pluginFactories) {
          try {
            const plugin = factory()
            const id = pluginId(plugin)
            if (!hasPluginIdFormat(id) || id === RESERVED_PLUGIN_ID)
              throw new Error(`Invalid plugin ID: ${id}`)
            if (definitions.has(id) || duplicates.has(id)) {
              definitions.delete(id)
              duplicates.add(id)
              throw new Error(`Duplicate plugin ID: ${id}`)
            }
            pluginManifest(plugin)
            if (typeof plugin.init !== 'function')
              throw new Error('Invalid plugin activation')
            definitions.set(id, plugin)
            deps.registerResources?.(plugin)
          } catch (error) {
            report('manifest', error)
          }
        }
        for (const id of active.keys()) {
          const plugin = definitions.get(id)
          if (
            !plugin ||
            plugin._loadError ||
            !getPluginState(plugin, states).isEnabled
          )
            await deactivate(id)
        }
        await Promise.all(
          [...definitions].map(async ([id, plugin]) => {
            if (requested !== revision || disposed) return
            try {
              const state = getPluginState(plugin, states)
              if (!state.isEnabled || plugin._loadError) {
                setState(
                  id,
                  plugin._loadError
                    ? {
                        status: plugin._incompatible ? 'incompatible' : 'error',
                        error: plugin._loadError,
                      }
                    : { status: 'disabled' }
                )
                return
              }
              const config = resolvePluginConfig(
                plugin,
                state.settings,
                state.settingsVersion
              )
              const signature = JSON.stringify([
                plugin.version,
                plugin._revision,
                config,
              ])
              if (active.get(id)?.signature === signature) return
              await deactivate(id)
              const instance: ActivePlugin = {
                signature,
                initializing: true,
                controller: new AbortController(),
                cleanups: [],
              }
              active.set(id, instance)
              setState(id, { status: 'activating' })
              const lifecycle: PluginLifecycle = {
                signal: instance.controller.signal,
                capabilities: plugin.capabilities ?? [],
                iconPrefix: plugin.icons?.prefix,
                notesDirectoryField: plugin.notesDirectoryField,
                configPresets: plugin.defaultConfig?.presets,
                onDispose: (cleanup) => {
                  if (instance.controller.signal.aborted)
                    throw new Error('Plugin is disposed')
                  if (instance.cleanups.length >= 64)
                    throw new Error('Too many plugin cleanup handlers')
                  instance.cleanups.push(cleanup)
                },
              }
              const ctx = deps.createPluginContext(
                id,
                () => clonePluginValue(config),
                lifecycle
              )
              const activation = Promise.resolve(plugin.init(ctx))
              // Late completion cannot resurrect a cancelled activation.
              void activation
                .then(async (cleanup) => {
                  if (instance.controller.signal.aborted && cleanup)
                    await runCleanup(id, cleanup)
                })
                .catch(() => {})
              const cleanup = await bounded(
                Promise.race([
                  activation,
                  new Promise<never>((_, reject) => {
                    const abort = () =>
                      reject(new Error('Plugin activation cancelled'))
                    if (instance.controller.signal.aborted) abort()
                    else
                      instance.controller.signal.addEventListener(
                        'abort',
                        abort,
                        { once: true }
                      )
                  }),
                ]),
                deps.activationTimeoutMs ?? DEFAULT_ACTIVATION_TIMEOUT_MS,
                'Plugin activation timed out'
              )
              instance.initializing = false
              if (cleanup && !instance.controller.signal.aborted)
                instance.cleanups.push(cleanup)
              if (requested !== revision || disposed) await deactivate(id)
              else setState(id, { status: 'active' })
            } catch (error) {
              const cancelled = active.get(id)?.controller.signal.aborted
              await deactivate(id)
              if (!cancelled) {
                report(id, error)
                setState(id, { status: 'error', error: errorMessage(error) })
              }
            }
          })
        )
        for (const id of runtimeStates.keys())
          if (!definitions.has(id)) runtimeStates.delete(id)
      })
      .catch((error) => report('manager', error))
    return pending
  }
  function dispose() {
    disposed = true
    revision++
    // Abort immediately, including an activation that is still awaiting work.
    for (const instance of active.values()) instance.controller.abort()
    pending = pending.then(async () => {
      for (const id of active.keys()) await deactivate(id)
    })
    return pending
  }
  return {
    failPlugin: async (id: string, error: Error) => {
      await deactivate(id)
      report(id, error)
      setState(id, { status: 'error', error: error.message })
    },
    getState: (id: string) => runtimeStates.get(id),
    isPluginEnabled,
    loadPlugins,
    dispose,
    getActivePluginNames: () =>
      [...active]
        .filter(([, instance]) => !instance.initializing)
        .map(([id]) => id),
  }
}
