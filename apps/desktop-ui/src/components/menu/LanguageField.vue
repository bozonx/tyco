<template>
  <!-- the field not being searched: its caption and value, clicked to search it -->
  <button
    type="button"
    class="language-field"
    @mousedown.prevent
    @click="emit('activate')"
  >
    <span class="language-field-label">{{ props.label }}</span>
    <span class="language-field-value" :class="{ 'is-empty': !props.value }">
      <Icon v-if="props.icon" :icon="props.icon" height="16" />
      <span class="language-field-text">{{
        props.value || props.emptyText
      }}</span>
    </span>
  </button>
</template>

<script setup lang="ts">
import { Icon } from '@iconify/vue'

const props = withDefaults(
  defineProps<{
    label: string
    value?: string
    icon?: string
    emptyText?: string
  }>(),
  { value: '', icon: '', emptyText: '' }
)

const emit = defineEmits<{ (e: 'activate'): void }>()
</script>

<style scoped>
.language-field {
  display: flex;
  flex: 1 1 0;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
  padding: 0;
  border: none;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.language-field-label {
  padding-left: 0.125rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-text-faint);
}

.language-field-value {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  height: 2.25rem;
  padding: 0 0.75rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-md);
  color: var(--color-base-content);
  font-size: 0.9375rem;
}

.language-field:hover .language-field-value {
  background-color: var(--app-hover);
}

.language-field-value.is-empty {
  color: var(--app-text-faint);
}

.language-field-text {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
