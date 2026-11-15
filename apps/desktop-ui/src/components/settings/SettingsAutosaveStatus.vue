<template>
  <span
    class="settings-autosave-status"
    :class="{ 'is-error': status === 'error' }"
    role="status"
    aria-live="polite"
    :aria-busy="status === 'saving' || undefined"
  >
    <span
      class="settings-autosave-placeholder"
      aria-hidden="true"
      :data-label="t('settings.autosaveSaving')"
    />
    <span
      class="settings-autosave-placeholder"
      aria-hidden="true"
      :data-label="t('settings.autosaveSaved')"
    />
    <span ref="contentRef" class="settings-autosave-content">
      <AppIcon
        v-if="status"
        :icon="
          status === 'saving'
            ? 'mdi:loading'
            : status === 'saved'
              ? 'mdi:check'
              : 'mdi:alert-circle-outline'
        "
        size="sm"
        :class="{ 'autosave-spinner': status === 'saving' }"
        aria-hidden="true"
      />
      <span>{{
        status === 'error'
          ? t('settings.autosaveFailed')
          : status === 'saving'
            ? t('settings.autosaveSaving')
            : status === 'saved'
              ? t('settings.autosaveSaved')
              : ''
      }}</span>
    </span>
  </span>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { useFeedbackMotion } from '../../composables/use-feedback-motion'
import { useI18n } from '../../composables/use-i18n'
import type { AutosaveSummary } from '../../lib/settings/autosave'
import AppIcon from '../common/AppIcon.vue'

const props = defineProps<{ status: AutosaveSummary }>()
const { t } = useI18n()
const contentRef = ref<HTMLElement | null>(null)
useFeedbackMotion(
  () => contentRef.value,
  () => props.status,
  { distancePx: 0, durationMs: 120 }
)
</script>

<style scoped>
.settings-autosave-status {
  display: inline-grid;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
.settings-autosave-status.is-error {
  color: var(--color-error);
}
.settings-autosave-placeholder,
.settings-autosave-content {
  grid-area: 1 / 1;
}
.settings-autosave-placeholder::before {
  content: attr(data-label);
}
.settings-autosave-placeholder {
  visibility: hidden;
  padding-inline-start: calc(1em + var(--space-xs));
}
.settings-autosave-content {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
}
.autosave-spinner {
  animation: autosave-spin 900ms linear infinite;
}
@keyframes autosave-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
