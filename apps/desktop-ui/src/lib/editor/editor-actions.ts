import { isPluginCancellation, isPluginError } from '@tyco/plugin-sdk'
import type { ActionItem } from '../action-menu/action-menu-store'
import type { EditItem } from '../edit-menu/edit-menu-store'
import type { EditSource } from './edit-source'
import { createTextEditModel } from '../edit-menu/text-edit'

export interface EditorActionsDeps {
  editor: {
    value: string
    selectedText: string
    selectionStart: number
    selectionEnd: number
    setValue: (text: string, source: EditSource) => void
    setSelection: (text: string, from: number, to: number) => void
    replaceSelection: (text: string, source: EditSource) => void
    actionText: () => string
    captureResultSource: (sourceText: string) => void
    focus: () => void
  }
  openVoice: (params: {
    inline: boolean
    onCorrected: (text: string) => void
    onCancel: () => void
  }) => void
  closeVoice: () => void
  t: (key: string) => string
  toast: (
    key: string,
    type: 'warn' | 'error',
    params?: Record<string, string | number>
  ) => void
}

/** Shared editor actions for the toolbar and context menu. */
export function createEditorActions(deps: EditorActionsDeps) {
  const { editor: editorInputStore, t, toast } = deps
  const getLabel = (item: ActionItem | EditItem): string =>
    item.labelKey ? t(item.labelKey) : item.name || ''

  const voiceRecognition = (): void => {
    const initialValue = editorInputStore.value
    const selectionStart = editorInputStore.selectionStart
    const selectionEnd = editorInputStore.selectionEnd

    deps.openVoice({
      // a bar under the editor instead of a screen over it, see `Editor`
      inline: true,
      onCorrected: (resultText: string) => {
        if (!resultText?.trim()) {
          deps.closeVoice()
          return
        }

        const newValue =
          initialValue.substring(0, selectionStart) +
          resultText +
          initialValue.substring(selectionEnd)
        const newCursorPosition = selectionStart + resultText.length

        editorInputStore.setValue(newValue, 'voice')
        editorInputStore.setSelection('', newCursorPosition, newCursorPosition)
        deps.closeVoice()
        editorInputStore.focus()
      },
      onCancel: () => deps.closeVoice(),
    })
  }

  const doAction = async (item: ActionItem): Promise<void> => {
    let value = item.useFullEditorText
      ? editorInputStore.value
      : editorInputStore.actionText()

    if (!item.preserveWhitespace) {
      value = value.trim()
    }

    editorInputStore.captureResultSource(value)
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
