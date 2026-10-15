export type ControlSize = 'xs' | 'sm' | 'md'
export type ButtonVariant =
  'primary' | 'neutral' | 'ghost' | 'danger' | 'danger-ghost'

export type ButtonTone = 'default' | 'muted' | 'accent'

export interface ButtonProps {
  type?: 'button' | 'submit' | 'reset'
  variant?: ButtonVariant
  size?: ControlSize
  icon?: string
  active?: boolean
  disabled?: boolean
  loading?: boolean
  square?: boolean
  tone?: ButtonTone
}
