/** Пункт плавающего меню редактора (ПКМ, bubble-меню, выбор способа вставки) */
export interface EditorMenuItem {
  id: string
  label: string
  icon?: string
  disabled?: boolean
  /** Отделить пунктом-разделителем от предыдущего элемента */
  separatorBefore?: boolean
  /** Подсветить как основной вариант (например, вариант исправления слова) */
  accent?: boolean
  action: () => void | Promise<void>
}

/**
 * `point` — at the mouse position (context menu); `above` — over the anchored
 * text line, flipping below when there is no room (bubble menu, which must not
 * cover the selection it belongs to); `below` — under the anchored line (paste
 * mode picker at the caret)
 */
export type MenuPlacement = 'point' | 'above' | 'below'
