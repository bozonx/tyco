import { computed } from 'vue'
import { createResultActions } from '../lib/action-menu/result-actions'
import { useActionMenuStore } from '../stores/action-menu'
import { useDesktopStore } from '../stores/desktop'
import { useEditorInputStore } from '../stores/editor-input'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useActionPages } from './use-action-pages'
import { useEditorNavigation } from './use-editor-navigation'
import { useI18n } from './use-i18n'

/**
 * The actions of a result window: every action page that takes text, opened on
 * the first one, with the page keys of `useActionPages`.
 */
export function useResultActions(
  sourceText?: () => string | undefined,
  options: { hasActionKeys?: () => boolean } = {}
) {
  const actionMenuStore = useActionMenuStore()
  actionMenuStore.openPage(0)
  const actionPages = useActionPages({
    textOnly: true,
    isDisabled: () => options.hasActionKeys?.() === false,
  })
  const desktopStore = useDesktopStore()
  const editorNavigation = useEditorNavigation()
  const editorInputStore = useEditorInputStore()
  const menuModalsStore = useMenuModalsStore()
  const { t } = useI18n()
  const model = createResultActions({
    getShortcutActions: () =>
      actionMenuStore.getShortcutActions(actionMenuStore.pageIndex),
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
    pageIndex: computed(() => actionMenuStore.pageIndex),
    pageIndexes: actionPages.pageIndexes,
    hasPages: computed(
      () => actionPages.hasPages.value && options.hasActionKeys?.() !== false
    ),
    motionDirection: actionPages.motionDirection,
    selectPage: actionPages.selectPage,
    leftLetterKeys: computed(model.shortcutActions),
    spaceKey: computed(model.primaryAction),
    isEditorTarget: computed(() => editorNavigation.isEditorPage()),
  }
}
