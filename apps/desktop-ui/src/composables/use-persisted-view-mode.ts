import { ref, watch } from 'vue'

import {
  cycleDiffMode,
  cycleParallelViewMode,
  resolveDiffMode,
  resolveParallelViewMode,
  type DiffViewMode,
  type ParallelViewMode,
} from '../lib/diff/diff-model'
import { useIpcStore } from '../stores/ipc'

export function usePersistedDiffMode() {
  const ipcStore = useIpcStore()
  const diffMode = ref<DiffViewMode>(
    resolveDiffMode(ipcStore.desktopState.userConfig.diffViewMode)
  )

  watch(diffMode, (mode) => {
    void ipcStore.saveUserConfig({
      ...ipcStore.desktopState.userConfig,
      diffViewMode: mode,
    })
  })

  function cycleMode() {
    diffMode.value = cycleDiffMode(diffMode.value)
  }

  return { diffMode, cycleMode }
}

export function usePersistedTranslationViewMode(hasSourceText: () => boolean) {
  const ipcStore = useIpcStore()
  const viewMode = ref<ParallelViewMode>(
    hasSourceText()
      ? resolveParallelViewMode(
          ipcStore.desktopState.userConfig.translation.viewMode
        )
      : 'result'
  )

  watch(viewMode, (newMode) => {
    void ipcStore.saveUserConfig({
      ...ipcStore.desktopState.userConfig,
      translation: {
        ...ipcStore.desktopState.userConfig.translation,
        viewMode: newMode,
      },
    })
  })

  function cycleMode() {
    if (!hasSourceText()) return
    viewMode.value = cycleParallelViewMode(viewMode.value)
  }

  return { viewMode, cycleMode }
}
