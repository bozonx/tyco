<template>
  <button
    type="button"
    class="disclosure-header"
    :class="{ 'disclosure-header--compact': density === 'compact' }"
    :aria-expanded="expanded"
    :aria-controls="expanded ? controls : undefined"
    @click="emit('toggle')"
  >
    <AppIcon
      v-if="icon"
      :icon="icon"
      :size="iconSize"
      class="shrink-0"
      :title="iconTitle"
      aria-hidden="true"
    />
    <span class="disclosure-copy"
      ><slot
        ><span class="disclosure-title">{{ title }}</span></slot
      ><span v-if="description" class="disclosure-description">{{
        description
      }}</span></span
    >
    <slot name="status" />
    <AppIcon
      v-if="!hideChevron"
      icon="mdi:chevron-down"
      :size="iconSize"
      class="disclosure-chevron"
      :class="{ 'is-expanded': expanded }"
      aria-hidden="true"
    />
  </button>
</template>
<script setup lang="ts">
import type { IconSize } from '../../lib/ui/icon-size'
import AppIcon from './AppIcon.vue'

withDefaults(
  defineProps<{
    expanded: boolean
    controls: string
    title?: string
    description?: string
    icon?: string
    iconTitle?: string
    density?: 'default' | 'compact'
    hideChevron?: boolean
    iconSize?: IconSize
  }>(),
  { iconSize: 'lg' }
)
const emit = defineEmits<{ toggle: [] }>()
</script>
<style scoped>
.disclosure-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
  min-width: 0;
  padding: var(--disclosure-padding, var(--space-md) var(--space-lg));
  color: inherit;
  text-align: left;
  cursor: pointer;
  background: var(--disclosure-background, var(--app-surface-raised));
}
.disclosure-header:hover {
  background: var(--disclosure-hover-background, var(--app-surface-sunken));
}
.disclosure-copy {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}
.disclosure-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.disclosure-description {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--app-text-muted);
  font-size: var(--text-caption);
  line-height: 1.35;
}
.disclosure-chevron {
  flex-shrink: 0;
  opacity: 0.7;
  transition: transform var(--transition-fast);
}
.disclosure-chevron.is-expanded {
  transform: rotate(180deg);
}
.disclosure-header--compact {
  flex: 1;
  width: auto;
  padding: var(--space-xs) 0;
  background: transparent;
}
.disclosure-header--compact:hover {
  background: transparent;
}
.disclosure-header--compact .disclosure-copy {
  flex-direction: row;
  align-items: center;
  gap: var(--space-sm);
}
</style>
