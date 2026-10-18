<template>
  <section class="surface disclosure-panel">
    <div class="disclosure-panel-header" @click="handleHeaderClick">
      <slot name="before" />
      <DisclosureHeader
        :expanded="expanded"
        :controls="bodyId"
        :title="title"
        :description="description"
        :icon="icon"
        :icon-title="iconTitle"
        :density="density"
        :hide-chevron="hasTrailingChevron"
        @toggle="emit('toggle')"
      >
        <template v-if="$slots.summary" #default
          ><slot name="summary"
        /></template>
        <template v-if="$slots.status" #status><slot name="status" /></template>
      </DisclosureHeader>
      <slot name="actions" />
      <AppIcon
        v-if="hasTrailingChevron"
        icon="mdi:chevron-down"
        size="lg"
        class="disclosure-chevron shrink-0"
        :class="{ 'is-expanded': expanded }"
        aria-hidden="true"
      />
    </div>
    <div v-if="expanded" :id="bodyId" class="disclosure-panel-body">
      <slot />
    </div>
  </section>
</template>
<script setup lang="ts">
import { computed, useId, useSlots } from 'vue'

import AppIcon from './AppIcon.vue'
import DisclosureHeader from './DisclosureHeader.vue'

const props = defineProps<{
  expanded: boolean
  title?: string
  description?: string
  icon?: string
  iconTitle?: string
  density?: 'default' | 'compact'
}>()
const emit = defineEmits<{ toggle: [] }>()
const bodyId = useId()
const slots = useSlots()

const hasTrailingChevron = computed(
  () => props.density === 'compact' || Boolean(slots.actions)
)

function handleHeaderClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null
  if (!target) return
  if (
    target.closest(
      'button, input, select, textarea, label, a, [role="button"], [data-prevent-toggle]'
    )
  ) {
    return
  }
  emit('toggle')
}
</script>
<style scoped>
.disclosure-panel {
  overflow: hidden;
  border-color: var(--disclosure-panel-border-color, var(--app-border));
  box-shadow: var(--app-shadow-sm);
}
.disclosure-panel-header {
  display: flex;
  align-items: center;
  gap: var(--disclosure-panel-header-gap, 0);
  min-width: 0;
  padding: var(--disclosure-panel-header-padding, 0);
  cursor: pointer;
}
.disclosure-panel-body {
  border-top: 1px solid var(--app-border-subtle);
}
.disclosure-chevron {
  opacity: 0.7;
  transition:
    transform var(--transition-fast),
    opacity var(--transition-fast);
}
.disclosure-chevron.is-expanded {
  transform: rotate(180deg);
}
.disclosure-panel-header:hover .disclosure-chevron {
  opacity: 1;
}
</style>
