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

/**
 * A view mode kept in the settings: the picked mode shows at once and is
 * stored, and a mode stored elsewhere, e.g. in another window, shows here too
 */
function usePersistedMode<T extends string>(
  stored: () => T,
  store: (mode: T) => void
) {
  const mode = ref(stored()) as Ref<T>
  watch(stored, (next) => {
    mode.value = next
  })
  watch(
    () => mode.value,
    (next) => {
      if (next !== stored()) store(next)
    }
  )
  return mode
}

export function usePersistedDiffMode() {
  const desktopStore = useDesktopStore()
  const diffMode = usePersistedMode<DiffViewMode>(
    () => resolveDiffMode(desktopStore.userConfig.diffViewMode),
    (diffViewMode) => void desktopStore.updateUserConfig({ diffViewMode })
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
      void desktopStore.updateUserConfig({
        translation: { ...desktopStore.userConfig.translation, viewMode: mode },
      })
  )

  function cycleMode() {
    if (!hasSourceText()) return
    viewMode.value = cycleParallelViewMode(viewMode.value)
  }

  return { viewMode, cycleMode }
}
