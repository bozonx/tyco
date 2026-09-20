import { useI18n } from './useI18n'
import useToast from './useToast'
import type { ActionItem } from '../stores/actionMenu'
import type { EditItem } from '../stores/edditMenu'
import { useEditorInputStore } from '../stores/editorInput'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'

/**
 * Действия редактора: пункты edit-меню, action-меню и голосовой ввод.
 *
 * Вынесено из `Editor.vue`, чтобы bubble-меню над выделением запускало ровно ту
 * же логику, а не её копию
 */
export const useEditorActions = () => {
  const editorInputStore = useEditorInputStore()
  const menuModalsStore = useMenuModalsStore()
  const { toast } = useToast()
  const { t } = useI18n()

  const getLabel = (item: ActionItem | EditItem): string =>
    item.labelKey ? t(item.labelKey) : item.name || ''

  const voiceRecognition = (): void => {
    const initialValue = editorInputStore.value
    const selectionStart = editorInputStore.selectionStart
    const selectionEnd = editorInputStore.selectionEnd

    menuModalsStore.nextModal(MenuModals.VOICE_RECOGNITION, {
      onCorrected: (resultText: string) => {
        if (!resultText?.trim()) {
          toast(t('toast.textNotSelected'), 'error')
          return
        }

        const newValue =
          initialValue.substring(0, selectionStart) +
          resultText +
          initialValue.substring(selectionEnd)
        const newCursorPosition = selectionStart + resultText.length

        editorInputStore.setValue(newValue, 'voice')
        editorInputStore.setSelection('', newCursorPosition, newCursorPosition)
        menuModalsStore.closeAll()
        editorInputStore.focus()
      },
      onCancel: () => menuModalsStore.closeAll(),
    })
  }

  const doAction = async (item: ActionItem): Promise<void> => {
    let value = editorInputStore.value

    if (!item.useFullEditorText && editorInputStore.selectedText) {
      value = editorInputStore.selectedText
    }

    if (!item.preserveWhitespace) {
      value = value.trim()
    }

    return item.action(value)
  }

  const doEdit = async (
    cb: (text: string) => Promise<string>
  ): Promise<void> => {
    let value = editorInputStore.value

    if (editorInputStore.selectedText) {
      value = editorInputStore.selectedText
    }

    value = value.trim()

    if (!value) {
      toast(t('toast.textNotSelected'), 'error')
      return
    }

    const result = await cb(value)

    editorInputStore.selectedText
      ? editorInputStore.replaceSelection(result, 'ai')
      : editorInputStore.setValue(result, 'ai')
  }

  return { getLabel, voiceRecognition, doAction, doEdit }
}
