import {
  type InputHTMLAttributes,
  inject,
  onBeforeUnmount,
  onMounted,
  onUpdated,
  useAttrs,
  useId,
} from 'vue'

import { fieldContextKey } from '../lib/ui/field-context'

/**
 * Forward native attributes to the control, including when its root is a
 * wrapper.
 */
export function useFieldControl(
  options: {
    wrapped?: boolean
    register?: boolean
    getLabel?: () => string | undefined
  } = {}
) {
  const attrs = useAttrs() as InputHTMLAttributes
  const field = inject(fieldContextKey, undefined)
  const generatedId = useId()
  const getId = () => String(attrs.id ?? generatedId)
  let unregister: (() => void) | undefined
  let registeredId: string | undefined
  function registerControl() {
    if (options.register === false || registeredId === getId()) return
    unregister?.()
    registeredId = getId()
    unregister = field?.register(registeredId)
  }
  onMounted(registerControl)
  onUpdated(registerControl)
  onBeforeUnmount(() => unregister?.())

  return () => ({
    ...attrs,
    ...(options.wrapped ? { class: undefined, style: undefined } : {}),
    id: getId(),
    'aria-label': attrs['aria-label'] ?? options.getLabel?.(),
    'aria-labelledby':
      attrs['aria-labelledby'] ??
      (attrs['aria-label'] || options.getLabel?.()
        ? undefined
        : field?.labelId),
    'aria-describedby':
      [attrs['aria-describedby'], field?.descriptionIds.value]
        .filter(Boolean)
        .join(' ') || undefined,
    'aria-invalid':
      attrs['aria-invalid'] ?? (field?.invalid.value || undefined),
    disabled: attrs.disabled ?? (field?.disabled.value || undefined),
    required: attrs.required ?? (field?.required.value || undefined),
  })
}
