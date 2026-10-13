<template>
  <div
    :role="kind === 'navigation' ? 'navigation' : 'tablist'"
    :aria-label="label"
    @keydown="onKeydown"
    class="app-tabs"
    :class="`app-tabs--${variant}`"
    :aria-orientation="
      kind === 'navigation'
        ? undefined
        : variant === 'vertical'
          ? 'vertical'
          : 'horizontal'
    "
  >
    <TabItem
      v-for="(tab, index) in tabs"
      :key="tab.key"
      :active="tab.key === activeTab"
      :navigation="kind === 'navigation'"
      :id="`${id}-tab-${index}`"
      :tabindex="kind === 'navigation' || tab.key === activeTab ? 0 : -1"
      :aria-controls="
        kind === 'navigation' ? undefined : (panelId ?? `${id}-panel`)
      "
      @click="onTabClick(tab.key)"
    >
      <Icon v-if="tab.icon" :icon="tab.icon" height="16" class="shrink-0" />
      <span class="truncate">{{ tab.text }}</span>
      <span v-if="tab.badge !== undefined" class="app-tabs-badge">
        {{ tab.badge }}
      </span>
    </TabItem>
  </div>
  <div
    v-if="$slots.panel && kind !== 'navigation'"
    :id="panelId ?? `${id}-panel`"
    role="tabpanel"
    :aria-labelledby="`${id}-tab-${tabs.findIndex((tab) => tab.key === activeTab)}`"
    tabindex="0"
  >
    <slot name="panel" :value="activeTab" />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, useId } from 'vue'

import Icon from './AppIcon.vue'
import TabItem from './TabItem.vue'

const emit = defineEmits<{ (e: 'update:value', key: string | number): void }>()

const props = withDefaults(
  defineProps<{
    tabs: {
      text: string
      key: string | number
      icon?: string
      badge?: string | number
    }[]
    label: string
    kind?: 'tabs' | 'navigation'
    panelId?: string
    value?: string | number
    variant?: 'underline' | 'segmented' | 'vertical'
  }>(),
  { value: undefined, variant: 'underline', kind: 'tabs' }
)

const id = useId()
const activeTab = computed(() => props.value ?? props.tabs[0]?.key ?? '')

const onTabClick = (key: string | number) => {
  emit('update:value', key)
}
async function onKeydown(event: KeyboardEvent) {
  if (props.kind === 'navigation' || !props.tabs.length) return
  const previous = props.variant === 'vertical' ? 'ArrowUp' : 'ArrowLeft'
  const next = props.variant === 'vertical' ? 'ArrowDown' : 'ArrowRight'
  if (![previous, next, 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  const current = props.tabs.findIndex((tab) => tab.key === activeTab.value)
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? props.tabs.length - 1
        : (current + (event.key === previous ? -1 : 1) + props.tabs.length) %
          props.tabs.length
  emit('update:value', props.tabs[index].key)
  await nextTick()
  document.getElementById(`${id}-tab-${index}`)?.focus()
}
</script>

<style scoped>
.app-tabs {
  display: flex;
  min-width: 0;
}

.app-tabs :deep(.app-tab) {
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
}

.app-tabs :deep(.app-tab:hover) {
  color: var(--color-base-content);
}

.app-tabs :deep(.app-tab.is-active) {
  color: var(--color-base-content);
}

.app-tabs-badge {
  padding: 0 0.375rem;
  border-radius: 999px;
  background-color: var(--app-active);
  font-size: 0.6875rem;
  font-weight: 600;
  line-height: 1.125rem;
  color: var(--app-text-muted);
}

/* ── underline ─────────────────────────────── */

.app-tabs--underline {
  gap: var(--space-lg);
  border-bottom: 1px solid var(--app-border);
  overflow-x: auto;
  scrollbar-width: none;
}

.app-tabs--underline :deep(.app-tab) {
  padding: 0.625rem 0.125rem;
  margin-bottom: -1px;
  border-bottom: 2px solid transparent;
}

.app-tabs--underline :deep(.app-tab.is-active) {
  border-bottom-color: var(--color-primary);
}

/* ── segmented ─────────────────────────────── */

.app-tabs--segmented {
  display: inline-flex;
  align-self: flex-start;
  gap: var(--segment-gap);
  padding: var(--segment-padding);
  max-width: 100%;
  border-radius: var(--radius-md);
  background-color: var(--app-surface-sunken);
  overflow-x: auto;
  scrollbar-width: none;
}

.app-tabs--segmented :deep(.app-tab) {
  justify-content: center;
  padding: var(--segment-option-padding);
  border-radius: calc(var(--radius-md) - 2px);
  font-size: var(--text-control);
}

.app-tabs--segmented :deep(.app-tab.is-active) {
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-segment);
}

/* ── vertical (sidebar navigation) ─────────── */

.app-tabs--vertical {
  flex-direction: column;
  gap: var(--segment-gap);
}

.app-tabs--vertical :deep(.app-tab) {
  width: 100%;
  padding: 0.4375rem 0.625rem;
  border-radius: var(--radius-md);
}

.app-tabs--vertical :deep(.app-tab:hover) {
  background-color: var(--app-hover);
}

.app-tabs--vertical :deep(.app-tab.is-active) {
  background-color: var(--app-accent-soft);
  color: var(--color-primary);
}
</style>
