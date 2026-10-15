<template>
  <component
    :is="group ? 'fieldset' : 'div'"
    :aria-labelledby="group ? labelId : undefined"
    :disabled="group ? disabled : undefined"
    class="field-row"
    :class="{
      vertical,
      nested,
      'field-row--compact': density === 'compact',
      'field-row--no-divider': separator === false,
    }"
  >
    <div class="field-row-label">
      <div class="field-row-title">
        <component
          :is="group ? 'span' : 'label'"
          :id="labelId"
          :for="group ? undefined : controlId"
          >{{ label }}</component
        >
        <InfoTooltip v-if="info" :text="info" />
        <slot name="info" />
      </div>
      <div v-if="hint" :id="hintId" class="field-row-hint">{{ hint }}</div>
      <div
        v-if="errors.length"
        :id="errorId"
        class="field-row-error"
        role="alert"
      >
        <p v-for="(message, index) in errors" :key="index">{{ message }}</p>
      </div>
      <div
        v-if="warnings.length || $slots.messages"
        :id="warningId"
        class="field-row-warning"
      >
        <p v-for="(message, index) in warnings" :key="index">{{ message }}</p>
        <slot name="messages" />
      </div>
    </div>
    <div class="field-row-control">
      <slot />
    </div>
  </component>
</template>

<script setup lang="ts">
import { computed, provide, ref, useId, useSlots } from 'vue'

import { fieldContextKey } from '../../lib/ui/field-context'
import InfoTooltip from './InfoTooltip.vue'

const props = withDefaults(
  defineProps<{
    group?: boolean
    label: string
    hint?: string
    error?: string | string[]
    warning?: string | string[]
    density?: 'default' | 'compact'
    separator?: boolean
    disabled?: boolean
    required?: boolean
    info?: string
    vertical?: boolean
    nested?: boolean
  }>(),
  { separator: true }
)

const slots = useSlots()
const errors = computed(() =>
  typeof props.error === 'string'
    ? [props.error].filter(Boolean)
    : (props.error ?? [])
)
const warnings = computed(() =>
  typeof props.warning === 'string'
    ? [props.warning].filter(Boolean)
    : (props.warning ?? [])
)
const warningId = useId()
const labelId = useId()
const hintId = useId()
const errorId = useId()
const controlId = ref<string>()
const controls = new Set<string>()
provide(fieldContextKey, {
  labelId,
  descriptionIds: computed(() =>
    [
      props.hint ? hintId : '',
      errors.value.length ? errorId : '',
      warnings.value.length || slots.messages ? warningId : '',
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
</script>

<style scoped>
.field-row {
  min-width: 0;
  margin: 0;
  border: 0;
  display: grid;
  grid-template-columns: var(--field-label-width) minmax(0, 1fr);
  align-items: start;
  gap: var(--space-lg);
  padding: var(--space-md) var(--space-lg);
}

.field-row + .field-row {
  border-top: 1px solid var(--app-border-subtle);
}

.nested {
  padding-left: calc(var(--space-lg) + var(--space-md));
}

.nested + .nested {
  border-top: none;
}

.field-row-label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 2.25rem;
  justify-content: center;
}

.field-row-title {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-body);
  font-weight: 500;
  line-height: 1.3;
}

.field-row-hint {
  font-size: var(--text-caption);
  line-height: 1.35;
  color: var(--app-text-muted);
}

.field-row-error {
  color: var(--color-error);
  font-size: var(--text-caption);
}

.field-row-control {
  display: flex;
  align-items: center;
  min-width: 0;
  min-height: 2.25rem;
}

.vertical {
  grid-template-columns: minmax(0, 1fr);
  gap: var(--space-sm);
}

.vertical .field-row-label {
  min-height: 0;
}

.vertical .field-row-title {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-size: var(--text-control);
}

@container (max-width: 40rem) {
  .field-row {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-sm);
  }
}
.field-row-warning {
  color: var(--color-warning);
  font-size: var(--text-caption);
}
.field-row-error p,
.field-row-warning p {
  margin: 0;
}
.field-row--compact {
  padding: 0;
}
.field-row--compact .field-row-title {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
.field-row--compact .field-row-control {
  flex-direction: column;
  align-items: stretch;
}
.field-row--compact + .field-row--compact,
.field-row.field-row--no-divider {
  border-top: none;
}
</style>
