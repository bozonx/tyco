import type { PluginPackagePreview } from '@tyco/shared'
import { ref, shallowRef } from 'vue'

export interface PluginInstallationDependencies {
  inspect(): Promise<PluginPackagePreview | null>
  install(preview: PluginPackagePreview): Promise<void>
  remove(id: string): Promise<void>
  refresh(): Promise<void>
  reservedIds: readonly string[]
  reportError(error: unknown): void
}

/** Inspection never activates code; installation requires an explicit UI action. */
export function createPluginInstallation(deps: PluginInstallationDependencies) {
  const preview = shallowRef<PluginPackagePreview | null>(null)
  const busy = ref(false)
  async function perform(action: () => Promise<void>) {
    if (busy.value) return
    busy.value = true
    try {
      await action()
    } catch (error) {
      deps.reportError(error)
    } finally {
      busy.value = false
    }
  }
  const inspect = () =>
    perform(async () => {
      preview.value = null
      const candidate = await deps.inspect()
      if (candidate && deps.reservedIds.includes(candidate.manifest.id))
        throw new Error('A package cannot replace a bundled plugin')
      preview.value = candidate
    })
  const install = () =>
    perform(async () => {
      const candidate = preview.value
      if (!candidate) return
      await deps.install(candidate)
      preview.value = null
      await deps.refresh()
    })
  const remove = (id: string) =>
    perform(async () => {
      if (deps.reservedIds.includes(id))
        throw new Error('A bundled plugin cannot be removed')
      await deps.remove(id)
      await deps.refresh()
    })
  return {
    preview,
    busy,
    inspect,
    install,
    remove,
    cancel: () => {
      if (!busy.value) preview.value = null
    },
  }
}
