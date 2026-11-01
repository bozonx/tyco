<template>
  <div class="advanced-toggle">
    <DisclosureHeader
      density="compact"
      icon="mdi:tune-variant"
      icon-size="md"
      :expanded="expanded"
      :controls="bodyId"
      :title="t(expanded ? 'settings.hideAdvanced' : 'settings.showAdvanced')"
      @toggle="emit('update:expanded', !expanded)"
    />
  </div>
  <div v-if="expanded" :id="bodyId"><slot /></div>
</template>
<script setup lang="ts">
import { useId } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import DisclosureHeader from '../common/DisclosureHeader.vue'

defineProps<{ expanded: boolean }>()
const emit = defineEmits<{ 'update:expanded': [value: boolean] }>()
const { t } = useI18n()
const bodyId = useId()
</script>
<style scoped>
.advanced-toggle {
  display: flex;
  padding: var(--space-xs) var(--space-md);
  font-size: var(--text-control);
  color: var(--app-text-muted);
}
</style>
