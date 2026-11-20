import { redo, selectAll, undo } from '@codemirror/commands'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'

/**
 * The letter a shortcut means: the one the layout types when it is Latin, so
 * that Ctrl+Y of a QWERTZ keyboard is not taken for Ctrl+Z; the QWERTY letter
 * at the same position otherwise, e.g. under a Cyrillic layout.
 */
export const shortcutLetter = (event: KeyboardEvent): string | null => {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase()
  const physical = /^Key([A-Z])$/.exec(event.code)
  return physical ? physical[1].toLowerCase() : null
}

/** Mod+A on any layout */
export const isSelectAllEvent = (event: KeyboardEvent): boolean => {
  const isMod = event.ctrlKey || event.metaKey
  if (!isMod || event.altKey || event.shiftKey) return false
  return shortcutLetter(event) === 'a'
}

/** Mod+Z on any layout */
export const isUndoEvent = (event: KeyboardEvent): boolean => {
  const isMod = event.ctrlKey || event.metaKey
  if (!isMod || event.altKey || event.shiftKey) return false
  return shortcutLetter(event) === 'z'
}

/** Mod+Shift+Z or Mod+Y on any layout */
export const isRedoEvent = (event: KeyboardEvent): boolean => {
  const isMod = event.ctrlKey || event.metaKey
  if (!isMod || event.altKey) return false
  const letter = shortcutLetter(event)
  return event.shiftKey ? letter === 'z' : letter === 'y'
}

/**
 * CodeMirror extension ensuring core editing shortcuts (undo, redo, select all)
 * work regardless of active keyboard layout (e.g. Russian JCUKEN where physical
 * KeyZ produces 'я' instead of 'z' or KeyA produces 'ф' instead of 'a').
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

      if (isSelectAllEvent(event)) {
        selectAll(view)
        return true
      }

      return false
    },
  })
