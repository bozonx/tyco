import { createEditorActions } from '../lib/editor/editor-actions'
import { useEditorInputStore } from '../stores/editor-input'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useI18n } from './use-i18n'
import useToast from './use-toast'

export const useEditorActions = () => {
  const editor = useEditorInputStore()
  const modals = useMenuModalsStore()
  const { toastKey } = useToast()
  const { t } = useI18n()

  return createEditorActions({
    editor,
    t,
    toastKey,
    openVoice: (params) =>
      modals.nextModal(MenuModals.VOICE_RECOGNITION, params),
    closeVoice: modals.closeAll,
  })
}
