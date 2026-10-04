import type { MarkdownCommand } from './markdown-commands'
import type { EditorMenuItem } from './menu-item'

export interface MarkupMenuSources {
  t: (key: string) => string
  run: (command: MarkdownCommand) => void
  /** Whether the raw markup is shown everywhere, not only on the edited line */
  showMarkup: boolean
  toggleShowMarkup: () => void
}

interface MarkupEntry {
  command: MarkdownCommand
  icon: string
  shortcut?: string
  /** Starts a new group of the menu */
  group?: boolean
}

const ENTRIES: MarkupEntry[] = [
  { command: 'bold', icon: 'mdi:format-bold', shortcut: 'Ctrl+B' },
  { command: 'italic', icon: 'mdi:format-italic', shortcut: 'Ctrl+I' },
  {
    command: 'strikethrough',
    icon: 'mdi:format-strikethrough-variant',
    shortcut: 'Ctrl+Shift+X',
  },
  { command: 'code', icon: 'mdi:code-tags', shortcut: 'Ctrl+E' },
  { command: 'link', icon: 'mdi:link-variant', shortcut: 'Ctrl+K' },
  { command: 'heading1', icon: 'mdi:format-header-1', group: true },
  { command: 'heading2', icon: 'mdi:format-header-2' },
  { command: 'heading3', icon: 'mdi:format-header-3' },
  { command: 'bulletList', icon: 'mdi:format-list-bulleted', group: true },
  { command: 'orderedList', icon: 'mdi:format-list-numbered' },
  { command: 'quote', icon: 'mdi:format-quote-close' },
]

/**
 * The "Markup" submenu of the editor: the formatting a quick buffer rarely
 * needs, so it has no toolbar, and the switch to the raw Markdown source
 */
export const buildMarkupItems = ({
  t,
  run,
  showMarkup,
  toggleShowMarkup,
}: MarkupMenuSources): EditorMenuItem[] => [
  ...ENTRIES.map((entry) => ({
    id: `markup-${entry.command}`,
    label: t(`editor.markup.${entry.command}`),
    icon: entry.icon,
    shortcut: entry.shortcut,
    separatorBefore: entry.group,
    action: () => run(entry.command),
  })),
  {
    id: 'markup-show-source',
    label: t('editor.markup.showSource'),
    icon: showMarkup
      ? 'mdi:checkbox-marked-outline'
      : 'mdi:checkbox-blank-outline',
    separatorBefore: true,
    action: toggleShowMarkup,
  },
]
