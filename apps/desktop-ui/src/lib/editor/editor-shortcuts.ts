import { indentLess } from '@codemirror/commands'
import { Prec, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import {
  DEFAULT_USER_CONFIG,
  hotkeyFromKeyboardEvent,
  normalizeHotkey,
  type EditorShortcutId,
  type EditorShortcuts,
} from '@tyco/shared'
import { indentOrInsertTab } from './indent-commands'
import { markdownCommands } from './markdown-commands'
import type { HotkeyKeyEvent } from '../hotkeys/hotkey-recorder'

export const EDITOR_SHORTCUT_IDS = Object.keys(
  DEFAULT_USER_CONFIG.editor.shortcuts
) as EditorShortcutId[]

/** Native text editing, search and app actions keep their own bindings. */
export const RESERVED_EDITOR_SHORTCUTS = new Set([
  'Ctrl+C',
  'Ctrl+X',
  'Ctrl+V',
  'Ctrl+Shift+V',
  'Ctrl+A',
  'Ctrl+Z',
  'Ctrl+Shift+Z',
  'Ctrl+Y',
  'Ctrl+F',
  'Ctrl+H',
  'Ctrl+Enter',
  'Super+C',
  'Super+X',
  'Super+V',
  'Super+Shift+V',
  'Super+A',
  'Super+Z',
  'Super+Shift+Z',
  'Super+Y',
  'Super+F',
  'Super+H',
  'Super+Enter',
])

/**
 * Latin layouts keep their letters; other layouts use the matching key
 * position.
 */
export function editorShortcutFromEvent(event: HotkeyKeyEvent): string | null {
  if (event.key === 'Tab' && !event.ctrlKey && !event.altKey && !event.metaKey)
    return event.shiftKey ? 'Shift+Tab' : 'Tab'
  // Shift alone is text input, except for the Tab focus/indent command.
  if (!event.ctrlKey && !event.altKey && !event.metaKey) return null
  return hotkeyFromKeyboardEvent(event)
}

export function editorShortcutLabel(id: EditorShortcutId): string {
  if (id === 'toggleMarkup') return 'editor.markup.showSource'
  if (id === 'indent' || id === 'outdent')
    return `settings.editorShortcuts.${id}`
  return `editor.markup.${id}`
}

export function editorShortcutsExtension(
  getShortcuts: () => EditorShortcuts,
  onToggleMarkup?: () => void
): Extension {
  return Prec.highest(
    EditorView.domEventHandlers({
      keydown(event, view) {
        if (event.isComposing || event.getModifierState('AltGraph'))
          return false
        const shortcut = editorShortcutFromEvent(event)
        if (!shortcut) return false
        const shortcuts = getShortcuts()
        const id = EDITOR_SHORTCUT_IDS.find(
          (id) =>
            shortcuts[id] === shortcut ||
            normalizeHotkey(shortcuts[id]) === shortcut
        )
        if (!id) return false
        if (id === 'indent') return indentOrInsertTab(view)
        if (id === 'outdent') return indentLess(view)
        if (id === 'toggleMarkup') {
          if (!onToggleMarkup) return false
          onToggleMarkup()
          return true
        }
        return markdownCommands[id](view)
      },
    })
  )
}
