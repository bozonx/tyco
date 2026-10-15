import { computed, provide, ref, useId } from 'vue'

import { fieldContextKey } from '../lib/ui/field-context'

export function useFieldContext(
  props: {
    hint?: string
    error?: string | string[]
    warning?: string | string[]
    disabled?: boolean
    required?: boolean
  },
  hasMessages: () => boolean
) {
  const messages = (value: string | string[] | undefined) =>
    (typeof value === 'string' ? [value] : (value ?? [])).filter(Boolean)
  const errors = computed(() => messages(props.error))
  const warnings = computed(() => messages(props.warning))
  const labelId = useId()
  const hintId = useId()
  const errorId = useId()
  const warningId = useId()
  const controlId = ref<string>()
  const controls = new Set<string>()
  provide(fieldContextKey, {
    labelId,
    descriptionIds: computed(() =>
      [
        props.hint ? hintId : '',
        errors.value.length ? errorId : '',
        warnings.value.length || hasMessages() ? warningId : '',
      ]
        .filter(Boolean)
        .join(' ')
    ),
    invalid: computed(() => errors.value.length > 0),
    disabled: computed(() => Boolean(props.disabled)),
    required: computed(() => Boolean(props.required)),
    register(id) {
      controls.add(id)
      controlId.value = controls.values().next().value
      return () => {
        controls.delete(id)
        controlId.value = controls.values().next().value
      }
    },
  })
  return { errors, warnings, labelId, hintId, errorId, warningId, controlId }
}
