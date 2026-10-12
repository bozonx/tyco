import type { ComputedRef, InjectionKey } from 'vue'

export interface FieldContext {
  labelId: string
  descriptionIds: ComputedRef<string>
  invalid: ComputedRef<boolean>
  disabled: ComputedRef<boolean>
  required: ComputedRef<boolean>
  register: (id: string) => () => void
}

export const fieldContextKey: InjectionKey<FieldContext> =
  Symbol('field-context')
