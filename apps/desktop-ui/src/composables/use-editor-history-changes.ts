import { onMounted, onUnmounted } from 'vue'
import { DESKTOP_EVENTS } from '@tyco/shared'

import { desktopClient } from '../lib/desktop/client'
import { clientLogger } from '../lib/logger'

/**
 * Calls `onChange` while the component is mounted whenever the editor history
 * changes in storage, from any window: e.g. a text the quick window inserted
 */
export function useEditorHistoryChanges(onChange: () => void) {
  let stop: (() => void) | undefined
  let unmounted = false

  onMounted(() => {
    void desktopClient
      .listen(DESKTOP_EVENTS.EDITOR_HISTORY_CHANGED, () => onChange())
      .then((unlisten) => {
        if (unmounted) unlisten()
        else stop = unlisten
      })
      .catch((error) =>
        clientLogger.warn(
          `Could not follow editor history changes: ${String(error)}`,
          'history'
        )
      )
  })

  onUnmounted(() => {
    unmounted = true
    stop?.()
  })
}
