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
