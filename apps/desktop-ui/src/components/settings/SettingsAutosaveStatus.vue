<template>
  <span
    v-if="status === 'error'"
    class="settings-autosave-status is-error"
    role="status"
  >
    {{ t('settings.autosaveFailed') }}
  </span>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import type { AutosaveSummary } from '../../lib/settings/autosave'

defineProps<{ status: AutosaveSummary }>()

const { t } = useI18n()
</script>

<style scoped>
.settings-autosave-status {
  font-size: var(--text-caption);
  color: var(--color-error);
}
</style>
