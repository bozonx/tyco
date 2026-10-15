<template>
  <p v-if="configIsNewer" class="settings-config-warning" role="alert">
    <Icon icon="mdi:alert-outline" height="16" class="shrink-0" />
    <span>{{ t('settings.configNewerWarning') }}</span>
    <Button
      size="sm"
      :disabled="isSaving || isReloading"
      @click="emit('reload')"
      >{{ t('settings.saveReload') }}</Button
    >
  </p>

  <div v-else class="settings-save-status" role="status" aria-live="polite">
    <span>{{
      t(
        isSaving
          ? 'settings.saveSaving'
          : saveError || conflicts.length
            ? 'settings.saveFailed'
            : hasUnsavedChanges
              ? 'settings.savePending'
              : 'settings.saveSaved'
      )
    }}</span>
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
      <Button size="sm" :loading="isSaving" @click="emit('retry')">{{
        t('settings.saveRetry')
      }}</Button>
      <Button size="sm" :disabled="isSaving" @click="emit('reload')">{{
        t('settings.saveReload')
      }}</Button>
    </template>
  </div>
</template>
<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import Icon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'

defineProps<{
  configIsNewer: boolean
  isSaving: boolean
  isReloading: boolean
  saveError: string | null
  conflicts: string[]
  hasUnsavedChanges: boolean
}>()
const emit = defineEmits<{ reload: []; keepLocal: []; retry: [] }>()
const { t } = useI18n()
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
