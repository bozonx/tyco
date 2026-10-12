<template>
  <div v-if="unavailable" class="secret-storage-notice">
    <Icon icon="mdi:alert-outline" height="16" class="shrink-0" />
    <p>{{ t('settings.secretStorageUnavailable') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useLlmStore } from '../../stores/llm'
import { Icon } from '@iconify/vue'

const { t } = useI18n()
const llmStore = useLlmStore()

const unavailable = computed(
  () =>
    llmStore.vaultState === 'unavailable' ||
    Object.values(llmStore.secrets).some((secret) => !secret.available)
)
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
