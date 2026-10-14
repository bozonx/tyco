/** Floating editor menu item (context menu, paste mode picker) */
export interface EditorMenuItem {
  id: string
  label: string
  icon?: string
  disabled?: boolean
  /** Separate from the previous item with a divider */
  separatorBefore?: boolean
  /** Highlight as the primary option (e.g. spelling correction suggestion) */
  accent?: boolean
  /** Keyboard shortcut shown on the right, e.g. `Ctrl+B` */
  shortcut?: string
  /** Nested items: the item opens a submenu instead of running an action */
  children?: EditorMenuItem[]
  action?: () => void | Promise<void>
}

/**
 * `point` — at the mouse position (context menu); `below` — under the anchored
 * line (paste mode picker at the caret)
 */
export type MenuPlacement = 'point' | 'below'
