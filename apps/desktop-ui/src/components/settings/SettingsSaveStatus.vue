<template>
  <p v-if="configIsNewer" class="settings-config-warning" role="alert">
    <AppIcon icon="mdi:alert-outline" size="md" class="shrink-0" />
    <span>{{ t('settings.configNewerWarning') }}</span>
    <Button
      size="sm"
      :disabled="isSaving || isReloading"
      @click="emit('reload')"
      >{{ t('settings.saveReload') }}</Button
    >
  </p>

  <div
    v-else-if="statusMessage"
    class="settings-save-status"
    role="status"
    aria-live="polite"
  >
    <span>{{ statusMessage }}</span>
    <template v-if="conflicts.length">
      <p>
        {{ t('settings.saveConflict', { fields: conflicts.join(', ') }) }}
      </p>
      <Button size="sm" :disabled="isSaving" @click="emit('keepLocal')">{{
        t('settings.saveKeepLocal')
      }}</Button>
      <Button size="sm" :disabled="isSaving" @click="emit('reload')">{{
        t('settings.saveReload')
      }}</Button>
    </template>
    <template v-else-if="saveError">
      <p>{{ saveError }}</p>
      <Button
        variant="primary"
        size="sm"
        :loading="isSaving"
        @click="emit('retry')"
        >{{ t('settings.saveRetry') }}</Button
      >
      <Button size="sm" :disabled="isSaving" @click="emit('reload')">{{
        t('settings.saveReload')
      }}</Button>
    </template>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'

const props = defineProps<{
  configIsNewer: boolean
  isSaving: boolean
  isReloading: boolean
  saveError: string | null
  conflicts: string[]
}>()
const emit = defineEmits<{ reload: []; keepLocal: []; retry: [] }>()
const { t } = useI18n()

const statusMessage = computed(() => {
  if (props.saveError || props.conflicts.length) return t('settings.saveFailed')
  return null
})
</script>
<style scoped>
.settings-save-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-lg);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
.settings-save-status p {
  flex-basis: 100%;
  overflow-wrap: anywhere;
}
.settings-config-warning {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  margin: 0 0 var(--space-xl);
  font-size: var(--text-body);
  color: var(--color-warning);
}
</style>
