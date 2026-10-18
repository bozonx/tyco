import { computed } from 'vue'
import { createResultActions } from '../lib/action-menu/result-actions'
import { useActionMenuStore } from '../stores/action-menu'
import { useDesktopStore } from '../stores/desktop'
import { useI18n } from './use-i18n'

export function useResultActions() {
  const actionMenuStore = useActionMenuStore()
  const desktopStore = useDesktopStore()
  const { t } = useI18n()
  const model = createResultActions({
    getShortcutActions: () => actionMenuStore.getShortcutActions(),
    getDefaultActions: () => actionMenuStore.getDefaultActions(),
    hasTargetWindow: () => Boolean(desktopStore.desktopState?.windowId),
    noTargetHint: () => t('selection.noTarget'),
  })
  return {
    leftLetterKeys: computed(model.shortcutActions),
    spaceKey: computed(model.primaryAction),
  }
}
