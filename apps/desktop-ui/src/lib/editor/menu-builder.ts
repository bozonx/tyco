import type { EditorMenuItem } from './menu-item'

/** Clipboard and selection commands available in every editor menu */
export interface EditorMenuCommands {
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
}

export interface EditorMenuSources {
  t: (key: string) => string
  commands: EditorMenuCommands
  groups: EditorMenuGroups
}

export interface ContextMenuSources extends EditorMenuSources {
  /** Whether the editor has a non-empty selection */
  selected: boolean
  /** Spelling suggestions for the word under the cursor, shown on top */
  suggestions?: EditorMenuItem[]
}

export interface BubbleToolbarSources extends EditorMenuSources {
  /** Opens the full context menu from the "more" button */
  openFullMenu: () => void
  /** How many main actions get their own button */
  maxActions?: number
}

export const DEFAULT_BUBBLE_ACTIONS = 3

export const CASE_ICON = 'mdi:format-letter-case'
export const FORMAT_ICON = 'mdi:code-braces'
export const ACTIONS_ICON = 'mdi:lightning-bolt-outline'
export const MORE_ICON = 'mdi:dots-horizontal'

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
 * Right-click menu: spelling suggestions, then clipboard, then transforms and
 * actions folded into submenus so the menu stays short
 */
export const buildContextMenu = ({
  t,
  commands,
  groups,
  selected,
  suggestions = [],
}: ContextMenuSources): EditorMenuItem[] => [
  ...suggestions,
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
  ]),
]

/**
 * Horizontal toolbar over a selection: icon buttons only. Transforms open as
 * dropdowns, the first main actions get their own buttons and everything else
 * is reachable through "more"
 */
export const buildBubbleToolbar = ({
  t,
  commands,
  groups,
  openFullMenu,
  maxActions = DEFAULT_BUBBLE_ACTIONS,
}: BubbleToolbarSources): EditorMenuItem[] => {
  const actions = groups.actionItems
    .filter((item) => !item.disabled)
    .slice(0, maxActions)
    .map((item) => ({ ...item, icon: actionIcon(item.id, item.icon) }))

  return [
    {
      id: 'copy',
      label: t('editor.menu.copy'),
      icon: 'mdi:content-copy',
      action: commands.copy,
    },
    {
      id: 'cut',
      label: t('editor.menu.cut'),
      icon: 'mdi:content-cut',
      action: commands.cut,
    },
    ...startGroup([
      ...submenu('case', t('editor.case'), CASE_ICON, groups.caseItems),
      ...submenu(
        'format',
        t('editor.format'),
        FORMAT_ICON,
        formatChildren(groups)
      ),
    ]),
    ...startGroup(actions),
    {
      id: 'more',
      label: t('editor.menu.more'),
      icon: MORE_ICON,
      separatorBefore: true,
      action: openFullMenu,
    },
  ]
}
