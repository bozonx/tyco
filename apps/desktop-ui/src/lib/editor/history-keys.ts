import { redo, undo } from '@codemirror/commands'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/**
 * Checks whether an event matches Undo:
 *
 * - Mod+Z (Latin)
 * - Mod+я (Cyrillic)
 * - Physical KeyZ with Mod modifier without Shift
 */
export const isUndoEvent = (event: KeyboardEvent): boolean => {
  const isMod = event.ctrlKey || event.metaKey
  if (!isMod || event.altKey || event.shiftKey) return false

  return (
    event.code === 'KeyZ' ||
    event.key === 'z' ||
    event.key === 'Z' ||
    event.key === 'я' ||
    event.key === 'Я'
  )
}

/**
 * Checks whether an event matches Redo:
 *
 * - Mod+Shift+Z (Latin) / Mod+Shift+я (Cyrillic) / physical KeyZ with Mod+Shift
 * - Mod+Y (Latin) / Mod+н (Cyrillic) / physical KeyY with Mod
 */
export const isRedoEvent = (event: KeyboardEvent): boolean => {
  const isMod = event.ctrlKey || event.metaKey
  if (!isMod || event.altKey) return false

  if (event.shiftKey) {
    return (
      event.code === 'KeyZ' ||
      event.key === 'z' ||
      event.key === 'Z' ||
      event.key === 'я' ||
      event.key === 'Я'
    )
  }

  return (
    event.code === 'KeyY' ||
    event.key === 'y' ||
    event.key === 'Y' ||
    event.key === 'н' ||
    event.key === 'Н'
  )
}

/**
 * CodeMirror extension ensuring undo and redo shortcuts work regardless of
 * active keyboard layout (e.g. Russian JCUKEN where physical KeyZ produces 'я'
 * instead of 'z').
 */
export const historyKeysExtension = (): Extension =>
  EditorView.domEventHandlers({
    keydown(event, view) {
      if (isUndoEvent(event)) {
        undo(view)
        return true
      }

      if (isRedoEvent(event)) {
        redo(view)
        return true
      }

      return false
    },
  })
