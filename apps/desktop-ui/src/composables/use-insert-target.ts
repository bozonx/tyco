import { computed } from 'vue'

import { useI18n } from './use-i18n'

import { shortInsertTargetName } from '../lib/action-menu/insert-target'
import { useDesktopStore } from '../stores/desktop'

/**
 * Whether text can go to the window Tyco was opened from, and how an insert
 * button names it: the application when it is known (`To Firefox`), the generic
 * label otherwise. One rule for every insert button, so a closed window
 * disables all of them alike
 */
export function useInsertTarget(genericLabelKey = 'action.insertIntoWindow') {
  const desktopStore = useDesktopStore()
  const { t } = useI18n()

  const canInsert = computed(() => desktopStore.canInsertIntoWindow)
  const appName = computed(() =>
    canInsert.value ? desktopStore.insertTargetAppName : undefined
  )
  const label = computed(() => {
    const shortName = shortInsertTargetName(appName.value)
    return shortName
      ? t('action.insertIntoApp', { app: shortName })
      : t(genericLabelKey)
  })
  /** The full name, for the tooltip of a button that shows it cut */
  const title = computed(() => {
    if (!canInsert.value) return t('menu.noInsertTarget')
    return appName.value
      ? t('action.insertIntoAppTitle', { app: appName.value })
      : undefined
  })

  return { canInsert, appName, label, title }
}
