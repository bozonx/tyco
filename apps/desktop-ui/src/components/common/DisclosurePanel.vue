<template>
  <section class="surface disclosure-panel">
    <div class="disclosure-panel-header">
      <slot name="before" />
      <DisclosureHeader
        :expanded="expanded"
        :controls="bodyId"
        :title="title"
        :description="description"
        :icon="icon"
        :icon-title="iconTitle"
        :density="density"
        @toggle="emit('toggle')"
      >
        <template v-if="$slots.summary" #default
          ><slot name="summary"
        /></template>
        <template v-if="$slots.status" #status><slot name="status" /></template>
      </DisclosureHeader>
      <slot name="actions" />
    </div>
    <div v-if="expanded" :id="bodyId" class="disclosure-panel-body">
      <slot />
    </div>
  </section>
</template>
<script setup lang="ts">
import { useId } from 'vue'

import DisclosureHeader from './DisclosureHeader.vue'

defineProps<{
  expanded: boolean
  title?: string
  description?: string
  icon?: string
  iconTitle?: string
  density?: 'default' | 'compact'
}>()
const emit = defineEmits<{ toggle: [] }>()
const bodyId = useId()
</script>
<style scoped>
.disclosure-panel {
  overflow: hidden;
  box-shadow: var(--app-shadow-sm);
}
.disclosure-panel-header {
  display: flex;
  align-items: center;
  min-width: 0;
}
.disclosure-panel-body {
  border-top: 1px solid var(--app-border-subtle);
}
</style>
