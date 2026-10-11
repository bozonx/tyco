<template>
  <div v-if="llmStore.secretStorage === 'file'" class="secret-storage-notice">
    <Icon icon="mdi:alert-outline" height="16" class="shrink-0" />
    <p>{{ t('settings.secretStorageFile') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import { useLlmStore } from '../../stores/llm'
import { Icon } from '@iconify/vue'

const { t } = useI18n()
const llmStore = useLlmStore()
</script>

<style scoped>
.secret-storage-notice {
  display: flex;
  gap: var(--space-sm);
  color: var(--color-warning);
  font-size: 0.8125rem;
  line-height: 1.45;
}

.secret-storage-notice p {
  margin: 0;
}
</style>
