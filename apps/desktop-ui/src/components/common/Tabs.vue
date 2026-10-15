<template>
  <div
    role="tablist"
    :aria-label="label"
    @keydown="onKeydown"
    class="app-tabs"
    aria-orientation="horizontal"
  >
    <button
      type="button"
      role="tab"
      class="app-tab"
      v-for="(tab, index) in tabs"
      :key="tab.id"
      :aria-selected="tab.id === activeTab"
      :class="{ 'is-active': tab.id === activeTab }"
      :aria-label="tab.name"
      :title="tab.name"
      :id="`${id}-tab-${index}`"
      :tabindex="tab.id === activeTab ? 0 : -1"
      :aria-controls="panelId ?? `${id}-panel`"
      @click="onTabClick(tab.id)"
    >
      <Icon v-if="tab.icon" :icon="tab.icon" height="16" class="shrink-0" />
      <span class="truncate">{{ tab.name }}</span>
      <Badge v-if="tab.badge !== undefined" size="xs">
        {{ tab.badge }}
      </Badge>
    </button>
  </div>
  <div
    v-if="$slots.panel"
    :id="panelId ?? `${id}-panel`"
    role="tabpanel"
    :aria-labelledby="`${id}-tab-${tabs.findIndex((tab) => tab.id === activeTab)}`"
    tabindex="0"
  >
    <slot name="panel" :value="activeTab" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, useId } from 'vue'

import type { ControlOption } from '../../lib/ui/control-option'
import Icon from './AppIcon.vue'
import Badge from './Badge.vue'

const emit = defineEmits<{
  (e: 'update:modelValue', key: string | number): void
}>()

const props = withDefaults(
  defineProps<{
    tabs: (ControlOption & { badge?: string | number })[]
    label: string
    panelId?: string

    modelValue?: string | number
  }>(),
  { modelValue: undefined }
)

const id = useId()
const activeTab = computed(() => props.modelValue ?? props.tabs[0]?.id ?? '')

const onTabClick = (key: string | number) => {
  emit('update:modelValue', key)
}
async function onKeydown(event: KeyboardEvent) {
  if (!props.tabs.length) return
  const previous = 'ArrowLeft'
  const next = 'ArrowRight'
  if (![previous, next, 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  const current = props.tabs.findIndex((tab) => tab.id === activeTab.value)
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? props.tabs.length - 1
        : (current + (event.key === previous ? -1 : 1) + props.tabs.length) %
          props.tabs.length

  emit('update:modelValue', props.tabs[index].id)
  await nextTick()
  document.getElementById(`${id}-tab-${index}`)?.focus()
}
</script>

<style scoped>
.app-tabs {
  display: flex;
  min-width: 0;
  gap: var(--space-lg);
  border-bottom: 1px solid var(--app-border);
  overflow-x: auto;
  scrollbar-width: none;
}

.app-tabs .app-tab {
  display: inline-flex;
  align-items: center;
  gap: 0.4375rem;
  min-width: 0;
  font-size: var(--text-body);
  font-weight: 500;
  line-height: 1.25;
  color: var(--app-text-muted);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast),
    box-shadow var(--transition-fast),
    border-color var(--transition-fast);
  padding: 0.625rem 0.125rem;
  margin-bottom: -1px;
  border-bottom: 2px solid transparent;
}

.app-tabs .app-tab:hover {
  color: var(--color-base-content);
}

.app-tabs .app-tab.is-active {
  color: var(--color-base-content);
  border-bottom-color: var(--color-primary);
}
</style>
