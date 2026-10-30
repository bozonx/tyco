import {
  type EditorInputSnapshot,
  isPluginCancellation,
  isPluginError,
} from '@tyco/plugin-sdk'
import { describeError } from '../errors/describe-error'
import type { ActionItem } from '../action-menu/action-menu-model'
import type { EditItem } from '../edit-menu/edit-menu-model'
import type { EditSource } from './edit-source'
import { createTextEditModel } from '../edit-menu/text-edit'
import { insertAtCursor } from '../chat/insert-at-cursor'
import type { DictationTarget } from '../stt/dictation-target'

export interface EditorActionsDependencies {
  editor: {
    getSnapshot(): EditorInputSnapshot
    applySnapshotEdit(
      snapshot: EditorInputSnapshot,
      text: string,
      scope: 'selection' | 'document'
    ): boolean
    value: string
    selectedText: string
    selectionStart: number
    selectionEnd: number
    setValue: (text: string, source: EditSource) => void
    setSelection: (text: string, from: number, to: number) => void
    replaceSelection: (text: string, source: EditSource) => void
    actionText: () => string
    captureResultSource: (sourceText: string) => void
    requestFocus: () => void
  }
  openVoice: (params: {
    inline: boolean
    target?: DictationTarget
    onCorrected: (text: string) => void
    onCancel: () => void
  }) => void
  closeVoice: () => void
  t: (key: string) => string
  toastKey: (
    key: string,
    type: 'warn' | 'error',
    params?: Record<string, string | number>
  ) => void
}

/** Shared editor actions for the toolbar and context menu. */
export function createEditorActions(deps: EditorActionsDependencies) {
  const { editor: editorInputStore, t, toastKey } = deps
  const getLabel = (item: ActionItem | EditItem): string =>
    item.labelKey ? t(item.labelKey) : item.label || item.name || ''

  const voiceRecognition = (): void => {
    const initialValue = editorInputStore.value
    const selectionStart = editorInputStore.selectionStart
    const selectionEnd = editorInputStore.selectionEnd

    deps.openVoice({
      // a bar under the editor instead of a screen over it, see `Editor`
      inline: true,
      target: 'editor',
      onCorrected: (resultText: string) => {
        if (!resultText?.trim()) {
          deps.closeVoice()
          return
        }

        // the editor may have changed meanwhile, e.g. synced from another
        // window: then the text goes to its current caret, not the old one
        const currentValue = editorInputStore.value
        const range =
          currentValue === initialValue
            ? { start: selectionStart, end: selectionEnd }
            : {
                start: editorInputStore.selectionStart,
                end: editorInputStore.selectionEnd,
              }
        const inserted = insertAtCursor(currentValue, range, resultText)

        editorInputStore.setValue(inserted.value, 'voice')
        editorInputStore.setSelection('', inserted.caret, inserted.caret)
        deps.closeVoice()
        editorInputStore.requestFocus()
      },
      onCancel: () => deps.closeVoice(),
    })
  }

  const executeAction = async (item: ActionItem): Promise<void> => {
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
    snapshot: editorInputStore.getSnapshot,
    applyEdit: editorInputStore.applySnapshotEdit,
  })

  /** Transforms the selection, or the whole text, in place: one undo step. */
  const applyTextEdit = async (item: EditItem): Promise<void> => {
    try {
      const result = await textEdit.run(item)
      if (result === 'empty') toastKey('toast.textNotSelected', 'warn')
      if (result === 'stale') toastKey('toast.textTransformStale', 'warn')
    } catch (error) {
      if (isPluginCancellation(error)) return
      const detail = describeError(error, t)
      if (isPluginError(error)) {
        toastKey(error.messageKey, 'error')
      } else {
        toastKey('toast.textTransformFailed', 'error', { detail })
      }
    }
  }

  return {
    getLabel,
    voiceRecognition,
    executeAction,
    applyTextEdit,
    doAction: executeAction,
    doEdit: applyTextEdit,
  }
}
