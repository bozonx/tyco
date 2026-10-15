export interface NavigationItem {
  key: string | number
  text: string
  icon?: string
  nested?: boolean
  status?: string
  isEnabled?: boolean
}
