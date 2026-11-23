<template>
  <!-- the live region stays in the page: one inserted with its text is often not read out -->
  <div
    class="settings-save-status-region"
    :class="{ 'is-shown': configIsNewer || statusMessage }"
    role="status"
    aria-live="polite"
  >
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

    <div v-else-if="statusMessage" class="settings-save-status">
      <AppIcon icon="mdi:alert-circle-outline" size="md" class="shrink-0" />
      <span class="settings-save-status-title">{{ statusMessage }}</span>
      <template v-if="conflicts.length">
        <p>
          {{ t('settings.saveConflict', { fields: conflicts.join(', ') }) }}
        </p>
        <Button size="sm" :disabled="isSaving" @click="emit('keepMine')">{{
          t('settings.saveKeepLocal')
        }}</Button>
        <Button size="sm" :disabled="isSaving" @click="emit('useTheirs')">{{
          t('settings.saveUseTheirs')
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
        <Button
          size="sm"
          :disabled="isSaving || isReloading"
          @click="emit('reload')"
          >{{ t('settings.saveReload') }}</Button
        >
      </template>
    </div>
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
  saveError: string
  /** The settings changed in another window as well, by their tab titles */
  conflicts: string[]
}>()
const emit = defineEmits<{
  reload: []
  keepMine: []
  useTheirs: []
  retry: []
}>()
const { t } = useI18n()

const statusMessage = computed(() => {
  if (props.saveError || props.conflicts.length) return t('settings.saveFailed')
  return null
})
</script>
<style scoped>
/* stays in view while the page scrolls: the autosave is paused until it is settled */
.settings-save-status-region.is-shown {
  position: sticky;
  top: 0;
  z-index: 2;
  margin: calc(-1 * var(--space-sm)) 0 var(--space-lg);
  padding-top: var(--space-sm);
  background-color: var(--color-base-100);
}
.settings-save-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-md);
  border: 1px solid color-mix(in oklab, var(--color-error) 40%, transparent);
  border-radius: var(--radius-md);
  background-color: color-mix(
    in oklab,
    var(--color-error) 8%,
    var(--color-base-100)
  );
  font-size: var(--text-caption);
  color: var(--color-base-content);
}
.settings-save-status-title {
  font-weight: 600;
  color: var(--color-error);
}
.settings-save-status p {
  flex-basis: 100%;
  overflow-wrap: anywhere;
}
.settings-config-warning {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  margin: 0;
  padding-bottom: var(--space-md);
  font-size: var(--text-body);
  color: var(--color-warning);
}
</style>
