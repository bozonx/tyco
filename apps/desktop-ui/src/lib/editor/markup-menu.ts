import { DEFAULT_USER_CONFIG, type EditorShortcuts } from '@tyco/shared'
import type { MarkdownCommand } from './markdown-commands'
import type { EditorMenuItem } from './menu-item'

export interface MarkupMenuSources {
  t: (key: string) => string
  run: (command: MarkdownCommand) => void
  shortcuts?: EditorShortcuts
  /** Whether the raw markup is shown everywhere, not only on the edited line */
  isMarkupShown: boolean
  toggleShowMarkup: () => void
}

interface MarkupEntry {
  command: MarkdownCommand
  icon: string
  /** Starts a new group of the menu */
  group?: boolean
}

const ENTRIES: MarkupEntry[] = [
  { command: 'bold', icon: 'mdi:format-bold' },
  { command: 'italic', icon: 'mdi:format-italic' },
  { command: 'strikethrough', icon: 'mdi:format-strikethrough-variant' },
  { command: 'code', icon: 'mdi:code-tags' },
  { command: 'link', icon: 'mdi:link-variant' },
  { command: 'normalText', icon: 'mdi:format-paragraph', group: true },
  { command: 'heading1', icon: 'mdi:format-header-1' },
  { command: 'heading2', icon: 'mdi:format-header-2' },
  { command: 'heading3', icon: 'mdi:format-header-3' },
  { command: 'heading4', icon: 'mdi:format-header-4' },
  { command: 'heading5', icon: 'mdi:format-header-5' },
  { command: 'heading6', icon: 'mdi:format-header-6' },
  { command: 'bulletList', icon: 'mdi:format-list-bulleted', group: true },
  { command: 'orderedList', icon: 'mdi:format-list-numbered' },
  { command: 'taskList', icon: 'mdi:format-list-checks' },
  { command: 'quote', icon: 'mdi:format-quote-close' },
]

function formatShortcutForMenu(shortcut?: string): string | undefined {
  if (!shortcut) return undefined
  return shortcut.replace(/\bPeriod\b/g, '.')
}

/**
 * The "Markup" submenu of the editor: the formatting a quick buffer rarely
 * needs, so it has no toolbar, and the switch to the raw Markdown source
 */
export const buildMarkupItems = ({
  t,
  run,
  isMarkupShown,
  toggleShowMarkup,
  shortcuts = DEFAULT_USER_CONFIG.editor.shortcuts,
}: MarkupMenuSources): EditorMenuItem[] => [
  ...ENTRIES.map((entry) => ({
    id: `markup-${entry.command}`,
    label: t(`editor.markup.${entry.command}`),
    icon: entry.icon,
    shortcut: formatShortcutForMenu(
      shortcuts[entry.command as keyof EditorShortcuts]
    ),
    separatorBefore: entry.group,
    action: () => run(entry.command),
  })),
  {
    id: 'markup-show-source',
    label: t('editor.markup.showSource'),
    icon: isMarkupShown
      ? 'mdi:checkbox-marked-outline'
      : 'mdi:checkbox-blank-outline',
    shortcut: formatShortcutForMenu(shortcuts.toggleMarkup),
    separatorBefore: true,
    action: toggleShowMarkup,
  },
]
