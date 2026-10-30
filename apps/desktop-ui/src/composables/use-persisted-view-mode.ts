import type { IpcResult } from '@tyco/shared'
import { ref, watch, type Ref } from 'vue'

import {
  cycleDiffMode,
  cycleParallelViewMode,
  resolveDiffMode,
  resolveParallelViewMode,
  type DiffViewMode,
  type ParallelViewMode,
} from '../lib/diff/diff-model'
import { useDesktopStore } from '../stores/desktop'
import useToast from './use-toast'

/**
 * A view mode kept in the settings: the picked mode shows at once and is
 * stored, and a mode stored elsewhere, e.g. in another window, shows here too
 */
function usePersistedMode<T extends string>(
  stored: () => T,
  store: (mode: T) => Promise<IpcResult<unknown>>
) {
  const { toastKey } = useToast()
  const mode = ref(stored()) as Ref<T>
  watch(stored, (next) => {
    mode.value = next
  })
  watch(
    () => mode.value,
    async (next, _previous, onCleanup) => {
      if (next === stored()) return
      let current = true
      onCleanup(() => {
        current = false
      })
      // a desktop call reports a failure in its result, it never throws
      const result = await store(next)
      if (result.success || !current) return
      mode.value = stored()
      toastKey('settings.saveFailed', 'error')
    }
  )
  return mode
}

export function usePersistedDiffMode() {
  const desktopStore = useDesktopStore()
  const diffMode = usePersistedMode<DiffViewMode>(
    () => resolveDiffMode(desktopStore.userConfig.editor.diffViewMode),
    (diffViewMode) =>
      desktopStore.updateUserConfig({
        editor: { ...desktopStore.userConfig.editor, diffViewMode },
      })
  )

  function cycleMode() {
    diffMode.value = cycleDiffMode(diffMode.value)
  }

  return { diffMode, cycleMode }
}

export function usePersistedTranslationViewMode(hasSourceText: () => boolean) {
  const desktopStore = useDesktopStore()
  const viewMode = usePersistedMode<ParallelViewMode>(
    () =>
      hasSourceText()
        ? resolveParallelViewMode(desktopStore.userConfig.translation.viewMode)
        : 'result',
    (mode) =>
      desktopStore.updateUserConfig({
        translation: { ...desktopStore.userConfig.translation, viewMode: mode },
      })
  )

  function cycleMode() {
    if (!hasSourceText()) return
    viewMode.value = cycleParallelViewMode(viewMode.value)
  }

  return { viewMode, cycleMode }
}
