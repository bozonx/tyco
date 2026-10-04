import type { EditorMenuItem } from './menu-item'

/** Clipboard, history and selection commands available in every editor menu */
export interface EditorMenuCommands {
  undo: () => void | Promise<void>
  redo: () => void | Promise<void>
  cut: () => void | Promise<void>
  copy: () => void | Promise<void>
  paste: () => void | Promise<void>
  pastePlain: () => void | Promise<void>
  selectAll: () => void | Promise<void>
}

/** Text transforms and actions, already bound to the editor text */
export interface EditorMenuGroups {
  caseItems: EditorMenuItem[]
  formatItems: EditorMenuItem[]
  /** Edit items registered by plugins outside the case/format groups */
  otherEditItems: EditorMenuItem[]
  actionItems: EditorMenuItem[]
  /** Markdown formatting commands and the raw markup switch */
  markupItems?: EditorMenuItem[]
}

export interface EditorMenuSources {
  t: (key: string) => string
  commands: EditorMenuCommands
  groups: EditorMenuGroups
}

export interface ContextMenuSources extends EditorMenuSources {
  /** Whether the editor has a non-empty selection */
  selected: boolean
  /** Whether an undo action is available */
  canUndo?: boolean
  /** Whether a redo action is available */
  canRedo?: boolean
  /** Spelling suggestions for the word under the cursor, shown on top */
  suggestions?: EditorMenuItem[]
}

export const UNDO_ICON = 'mdi:undo'
export const REDO_ICON = 'mdi:redo'
export const CASE_ICON = 'mdi:format-letter-case'
export const FORMAT_ICON = 'mdi:code-braces'
export const MARKUP_ICON = 'mdi:language-markdown-outline'
export const ACTIONS_ICON = 'mdi:lightning-bolt-outline'

/** Icons of the standard actions, which do not carry their own */
const ACTION_ICONS: Record<string, string> = {
  insertIntoWindow: 'mdi:application-export',
  copyToClipboard: 'mdi:clipboard-arrow-right-outline',
  aiTask: 'mdi:robot-outline',
  correction: 'mdi:auto-fix',
  translation: 'mdi:translate',
  askInChat: 'mdi:chat-outline',
}

/** Icon of an action: its own one, the standard one, or a generic fallback */
export const actionIcon = (id?: string, icon?: string): string =>
  icon || (id && ACTION_ICONS[id]) || ACTIONS_ICON

/**
 * The first item of a group is separated from whatever precedes it. The menu
 * never draws a separator above its very first item
 */
const startGroup = (items: EditorMenuItem[]): EditorMenuItem[] =>
  items.map((item, index) =>
    index === 0 ? { ...item, separatorBefore: true } : item
  )

const submenu = (
  id: string,
  label: string,
  icon: string,
  children: EditorMenuItem[]
): EditorMenuItem[] =>
  children.length > 0 ? [{ id, label, icon, children }] : []

/** Format items plus plugin edit items, split by a separator */
const formatChildren = (groups: EditorMenuGroups): EditorMenuItem[] => [
  ...groups.formatItems,
  ...(groups.formatItems.length > 0
    ? startGroup(groups.otherEditItems)
    : groups.otherEditItems),
]

/**
 * Right-click menu: spelling suggestions, then history, then clipboard, then
 * transforms and actions folded into submenus so the menu stays short
 */
export const buildContextMenu = ({
  t,
  commands,
  groups,
  selected,
  canUndo = false,
  canRedo = false,
  suggestions = [],
}: ContextMenuSources): EditorMenuItem[] => [
  ...suggestions,
  ...startGroup([
    {
      id: 'undo',
      label: t('editor.menu.undo'),
      icon: UNDO_ICON,
      disabled: !canUndo,
      action: commands.undo,
    },
    {
      id: 'redo',
      label: t('editor.menu.redo'),
      icon: REDO_ICON,
      disabled: !canRedo,
      action: commands.redo,
    },
  ]),
  ...startGroup([
    {
      id: 'cut',
      label: t('editor.menu.cut'),
      icon: 'mdi:content-cut',
      disabled: !selected,
      action: commands.cut,
    },
    {
      id: 'copy',
      label: t('editor.menu.copy'),
      icon: 'mdi:content-copy',
      disabled: !selected,
      action: commands.copy,
    },
    {
      id: 'paste',
      label: t('editor.menu.paste'),
      icon: 'mdi:content-paste',
      action: commands.paste,
    },
    {
      id: 'paste-plain',
      label: t('editor.menu.pasteAsText'),
      action: commands.pastePlain,
    },
    {
      id: 'select-all',
      label: t('editor.menu.selectAll'),
      icon: 'mdi:select-all',
      action: commands.selectAll,
    },
  ]),
  ...startGroup([
    ...submenu(
      'actions',
      t('editor.menu.actions'),
      ACTIONS_ICON,
      groups.actionItems
    ),
    ...submenu('case', t('editor.case'), CASE_ICON, groups.caseItems),
    ...submenu(
      'format',
      t('editor.format'),
      FORMAT_ICON,
      formatChildren(groups)
    ),
    ...submenu(
      'markup',
      t('editor.markup.title'),
      MARKUP_ICON,
      groups.markupItems ?? []
    ),
  ]),
]
