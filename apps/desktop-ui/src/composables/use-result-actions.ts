import { computed } from 'vue'
import { createResultActions } from '../lib/action-menu/result-actions'
import { useActionMenuStore } from '../stores/action-menu'
import { useDesktopStore } from '../stores/desktop'
import { useEditorInputStore } from '../stores/editor-input'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useEditorNavigation } from './use-editor-navigation'
import { useI18n } from './use-i18n'

export function useResultActions(sourceText?: () => string | undefined) {
  const actionMenuStore = useActionMenuStore()
  const desktopStore = useDesktopStore()
  const editorNavigation = useEditorNavigation()
  const editorInputStore = useEditorInputStore()
  const menuModalsStore = useMenuModalsStore()
  const { t } = useI18n()
  const model = createResultActions({
    getShortcutActions: () => actionMenuStore.getShortcutActions(),
    getDefaultActions: () => actionMenuStore.getDefaultActions(),
    hasTargetWindow: () => desktopStore.canInsertIntoWindow,
    noTargetHint: () => t('selection.noTarget'),
    isEditorPage: () => editorNavigation.isEditorPage(),
    replaceInEditorAction: {
      id: 'applyToEditor',
      labelKey: 'menu.replaceInEditor',
      icon: 'mdi:pencil-outline',
      action: async (text: string) => {
        if (
          editorNavigation.applyEditorTransfer(text, sourceText?.()) === false
        )
          return
        menuModalsStore.closeAll()
        editorInputStore.requestFocus()
      },
    },
  })
  return {
    leftLetterKeys: computed(model.shortcutActions),
    spaceKey: computed(model.primaryAction),
    isEditorTarget: computed(() => editorNavigation.isEditorPage()),
  }
}
