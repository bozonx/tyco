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
      'field-row--inline': inline,
      'field-row--flow': flow,
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
      <FieldMessages
        :errors="errors"
        :warnings="warnings"
        :error-id="errorId"
        :warning-id="warningId"
        ><template v-if="$slots.messages" #default
          ><slot name="messages" /></template
      ></FieldMessages>
    </div>
    <div class="field-row-control">
      <slot />
    </div>
  </component>
</template>

<script setup lang="ts">
import { useSlots } from 'vue'

import { useFieldContext } from '../../composables/use-field-context'
import FieldMessages from './FieldMessages.vue'
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
    inline?: boolean
    flow?: boolean
  }>(),
  { separator: true }
)

const slots = useSlots()
const { errors, warnings, labelId, hintId, errorId, warningId, controlId } =
  useFieldContext(props, () => Boolean(slots.messages))
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

.field-row--inline {
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
}

.field-row--inline .field-row-control {
  justify-content: flex-end;
}

.field-row--flow {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs) var(--space-sm);
}

.field-row--flow .field-row-label {
  min-height: 0;
  flex-direction: row;
  align-items: center;
}

.field-row--flow .field-row-control {
  min-height: 0;
}

@container (max-width: 40rem) {
  .field-row:not(.field-row--inline):not(.field-row--flow) {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--space-sm);
  }
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
