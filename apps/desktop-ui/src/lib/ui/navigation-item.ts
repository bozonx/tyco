import type { ControlOption } from './control-option'

export interface NavigationItem extends ControlOption {
  nested?: boolean
  status?: string
  isEnabled?: boolean
}
