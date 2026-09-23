<template>
  <div class="in-progress">
    <span class="loading loading-spinner loading-lg text-primary"></span>
    <div class="in-progress-label">
      <span v-if="props.label">{{ props.label }}</span>
      <span v-else-if="props.ai">{{ t('menu.aiRequest') }}</span>
      <span v-else-if="props.correction">{{ t('menu.correction') }}</span>
      <span v-else>{{ t('common.inProgress') }}</span>
    </div>
    <button v-if="props.onCancel" class="btn btn-ghost" @click="props.onCancel">
      {{ t('common.cancel') }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'

const props = withDefaults(
  defineProps<{
    ai?: boolean
    correction?: boolean
    label?: string
    onCancel?: () => void
  }>(),
  { ai: false, correction: false }
)

const { t } = useI18n()
</script>

<style scoped>
.in-progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  width: 100%;
  height: 100%;
}

.in-progress-label {
  font-size: 0.9375rem;
  font-weight: 500;
  color: var(--app-text-muted);
}
</style>
