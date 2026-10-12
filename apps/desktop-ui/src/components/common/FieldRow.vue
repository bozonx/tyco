<template>
  <div class="field-row" :class="{ vertical: vertical, nested: nested }">
    <div class="field-row-label">
      <div class="field-row-title">
        <label :id="labelId" :for="controlId">{{ label }}</label>
        <InfoTooltip v-if="info" :text="info" />
        <slot name="info" />
      </div>
      <div v-if="hint" :id="hintId" class="field-row-hint">{{ hint }}</div>
      <div v-if="error" :id="errorId" class="field-row-error" role="alert">
        {{ error }}
      </div>
    </div>
    <div class="field-row-control">
      <slot />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, provide, ref, useId } from 'vue'

import { fieldContextKey } from '../../lib/ui/field-context'
import InfoTooltip from './InfoTooltip.vue'

const props = defineProps<{
  label: string
  hint?: string
  error?: string
  disabled?: boolean
  required?: boolean
  info?: string
  vertical?: boolean
  nested?: boolean
}>()

const labelId = useId()
const hintId = useId()
const errorId = useId()
const controlId = ref<string>()
const controls = new Set<string>()
provide(fieldContextKey, {
  labelId,
  descriptionIds: computed(() =>
    [props.hint ? hintId : '', props.error ? errorId : '']
      .filter(Boolean)
      .join(' ')
  ),
  invalid: computed(() => Boolean(props.error)),
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

@media (max-width: 640px) {
  .field-row {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-sm);
  }
}
</style>
