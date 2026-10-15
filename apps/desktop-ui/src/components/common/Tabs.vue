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
      :key="tab.key"
      :aria-selected="tab.key === activeTab"
      :class="{ 'is-active': tab.key === activeTab }"
      :aria-label="tab.text"
      :title="tab.text"
      :id="`${id}-tab-${index}`"
      :tabindex="tab.key === activeTab ? 0 : -1"
      :aria-controls="panelId ?? `${id}-panel`"
      @click="onTabClick(tab.key)"
    >
      <Icon v-if="tab.icon" :icon="tab.icon" height="16" class="shrink-0" />
      <span class="truncate">{{ tab.text }}</span>
      <span v-if="tab.badge !== undefined" class="app-tabs-badge">
        {{ tab.badge }}
      </span>
    </button>
  </div>
  <div
    v-if="$slots.panel"
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

const emit = defineEmits<{
  (e: 'update:modelValue', key: string | number): void
}>()

const props = withDefaults(
  defineProps<{
    tabs: {
      text: string
      key: string | number
      icon?: string
      badge?: string | number
    }[]
    label: string
    panelId?: string

    modelValue?: string | number
  }>(),
  { modelValue: undefined }
)

const id = useId()
const activeTab = computed(() => props.modelValue ?? props.tabs[0]?.key ?? '')

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
  const current = props.tabs.findIndex((tab) => tab.key === activeTab.value)
  const index =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? props.tabs.length - 1
        : (current + (event.key === previous ? -1 : 1) + props.tabs.length) %
          props.tabs.length

  emit('update:modelValue', props.tabs[index].key)
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

.app-tabs-badge {
  padding: 0 0.375rem;
  border-radius: 999px;
  background-color: var(--app-active);
  font-size: var(--text-micro);
  font-weight: 600;
  line-height: 1.125rem;
  color: var(--app-text-muted);
}
</style>
