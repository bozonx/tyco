import { onBeforeUnmount } from 'vue'

import {
  type DraftFlush,
  useSettingsSessionStore,
} from '../stores/settings-session'

/**
 * A draft of a settings page saved apart from the config, e.g. of an AI
 * profile: saved when the page is left, and on exit while it is open
 */
export function useSettingsDraft(flush: DraftFlush) {
  const unregister = useSettingsSessionStore().registerDraft(flush)
  onBeforeUnmount(() => {
    // an exit during this save still waits for it
    void flush()
      .catch(() => false)
      .finally(unregister)
  })
}
