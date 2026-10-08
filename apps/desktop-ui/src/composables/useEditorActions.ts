import { createTextEditModel } from '../lib/edit-menu/text-edit'
import { isPluginCancellation, isPluginError } from '@tyco/plugin-sdk'
import { useI18n } from './useI18n'
import useToast from './useToast'
import type { ActionItem } from '../stores/actionMenu'
import type { EditItem } from '../stores/editMenu'
import { useEditorInputStore } from '../stores/editorInput'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'

/**
 * Действия редактора: пункты edit-меню, action-меню и голосовой ввод.
 *
 * Вынесено из `Editor.vue`, чтобы контекстное меню редактора запускало ровно ту
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
      // a bar under the editor instead of a screen over it, see `Editor`
      inline: true,
      onCorrected: (resultText: string) => {
        if (!resultText?.trim()) {
          menuModalsStore.closeAll()
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
    let value = item.useFullEditorText
      ? editorInputStore.value
      : editorInputStore.actionText()

    if (!item.preserveWhitespace) {
      value = value.trim()
    }

    return item.action(value)
  }

  const textEdit = createTextEditModel({
    snapshot: () => ({
      text: editorInputStore.value,
      selectedText: editorInputStore.selectedText,
      from: editorInputStore.selectionStart,
      to: editorInputStore.selectionEnd,
    }),
    replaceSelection: (text) => editorInputStore.replaceSelection(text, 'ai'),
    replaceText: (text) => editorInputStore.setValue(text, 'ai'),
  })

  /** Transforms the selection, or the whole text, in place: one undo step. */
  const doEdit = async (item: EditItem): Promise<void> => {
    try {
      const result = await textEdit.run(item)
      if (result === 'empty') toast('toast.textNotSelected', 'warn')
      if (result === 'stale') toast('toast.textTransformStale', 'warn')
    } catch (error) {
      if (isPluginCancellation(error)) return
      const detail = error instanceof Error ? error.message : String(error)
      if (isPluginError(error)) {
        toast(error.messageKey, 'error')
      } else {
        toast('toast.textTransformFailed', 'error', { detail })
      }
    }
  }

  return { getLabel, voiceRecognition, doAction, doEdit }
}
