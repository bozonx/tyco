export interface ControlOption<T extends string | number = string | number> {
  id: T
  name: string
  icon?: string
  title?: string
}
