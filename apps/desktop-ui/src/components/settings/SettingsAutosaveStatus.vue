<template>
  <span
    v-if="status"
    class="settings-autosave-status"
    :class="{ 'is-error': status === 'error' }"
    role="status"
  >
    {{ t(AUTOSAVE_STATUS_KEYS[status]) }}
  </span>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import type { AutosaveSummary } from '../../lib/settings/autosave'

defineProps<{ status: AutosaveSummary }>()

const AUTOSAVE_STATUS_KEYS = {
  error: 'settings.autosaveFailed',
  saving: 'settings.autosaveSaving',
  saved: 'settings.autosaveSaved',
} as const

const { t } = useI18n()
</script>

<style scoped>
.settings-autosave-status {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.settings-autosave-status.is-error {
  color: var(--color-error);
}
</style>
