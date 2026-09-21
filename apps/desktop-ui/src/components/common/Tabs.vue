<template>
  <div
    role="tablist"
    class="app-tabs"
    :class="`app-tabs--${variant}`"
    :aria-orientation="variant === 'vertical' ? 'vertical' : 'horizontal'"
  >
    <TabItem
      v-for="tab in tabs"
      :key="tab.key"
      :active="tab.key === activeTab"
      @click="onTabClick(tab.key)"
    >
      <Icon v-if="tab.icon" :icon="tab.icon" height="16" class="shrink-0" />
      <span class="truncate">{{ tab.text }}</span>
      <span v-if="tab.badge !== undefined" class="app-tabs-badge">
        {{ tab.badge }}
      </span>
    </TabItem>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import TabItem from './TabItem.vue'
import { Icon } from '@iconify/vue'

const emit = defineEmits<{ (e: 'update:value', key: string | number): void }>()

const props = withDefaults(
  defineProps<{
    tabs: {
      text: string
      key: string | number
      icon?: string
      badge?: string | number
    }[]
    value?: string | number
    variant?: 'underline' | 'segmented' | 'vertical'
  }>(),
  { value: undefined, variant: 'underline' }
)

const activeTab = computed(() => props.value ?? props.tabs[0]?.key ?? '')

const onTabClick = (key: string | number) => {
  emit('update:value', key)
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
  font-size: 0.875rem;
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
  gap: 2px;
  padding: 3px;
  max-width: 100%;
  border-radius: var(--radius-md);
  background-color: var(--app-surface-sunken);
  overflow-x: auto;
  scrollbar-width: none;
}

.app-tabs--segmented :deep(.app-tab) {
  justify-content: center;
  padding: 0.3125rem 0.75rem;
  border-radius: calc(var(--radius-md) - 2px);
  font-size: 0.8125rem;
}

.app-tabs--segmented :deep(.app-tab.is-active) {
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-segment);
}

/* ── vertical (sidebar navigation) ─────────── */

.app-tabs--vertical {
  flex-direction: column;
  gap: 2px;
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
