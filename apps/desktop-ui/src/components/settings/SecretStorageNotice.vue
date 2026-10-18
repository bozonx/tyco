<template>
  <div v-if="unavailable" class="secret-storage-notice">
    <Icon icon="mdi:alert-outline" height="16" class="shrink-0" />
    <p>{{ t('settings.secretStorageUnavailable') }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSecretsStore } from '../../stores/secrets'
import Icon from '../common/AppIcon.vue'

const { t } = useI18n()
const secretsStore = useSecretsStore()

const unavailable = computed(
  () =>
    secretsStore.vaultState === 'unavailable' ||
    Object.values(secretsStore.secrets).some((secret) => !secret.available)
)
</script>

<style scoped>
.secret-storage-notice {
  display: flex;
  gap: var(--space-sm);
  color: var(--color-warning);
  font-size: var(--text-control);
  line-height: 1.45;
}

.secret-storage-notice p {
  margin: 0;
}
</style>
