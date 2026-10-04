/** Пункт плавающего меню редактора (ПКМ, выбор способа вставки) */
export interface EditorMenuItem {
  id: string
  label: string
  icon?: string
  disabled?: boolean
  /** Отделить пунктом-разделителем от предыдущего элемента */
  separatorBefore?: boolean
  /** Подсветить как основной вариант (например, вариант исправления слова) */
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
