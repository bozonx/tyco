<template>
  <FieldRow :label="row.label" :error="error">
    <template #info>
      <InfoPopover :aria-label="t('settings.externalMethods')" align="start">
        <div class="hotkey-info">
          <p v-if="row.description">{{ row.description }}</p>
          <p class="hotkey-info-title">
            {{ t('settings.externalMethods') }}
          </p>
          <p>{{ row.externalHint }}</p>
          <div class="external-command">
            <code>{{ row.command }}</code>
            <CopyButton
              :value="row.command"
              :label="t('settings.copyActivationCommand')"
            />
          </div>
        </div>
      </InfoPopover>
    </template>
    <div class="hotkey-control">
      <HotkeyInput
        :model-value="row.value"
        :aria-label="row.label"
        :placeholder="t('settings.hotkeyNotAssigned')"
        :readonly="!isEditable"
        :platform="platform"
        @update:model-value="emit('set', $event)"
        @recording="emit('recording', $event)"
      />
      <IconButton
        v-if="isEditable && row.value"
        size="sm"
        variant="ghost"
        icon="mdi:close"
        :label="t('settings.unassignHotkey')"
        @click="emit('set', '')"
      />
      <IconButton
        v-if="isEditable && row.defaultValue && row.value !== row.defaultValue"
        size="sm"
        variant="ghost"
        icon="mdi:restore"
        :label="t('settings.resetToDefault')"
        @click="emit('set', row.defaultValue)"
      />
      <div v-if="externalCommand" class="external-command">
        <code>{{ externalCommand }}</code>
        <CopyButton
          :value="externalCommand"
          :label="t('settings.copyHotkeyCommand')"
        />
      </div>
    </div>
  </FieldRow>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import type { GlobalHotkeyRowModel } from '../../lib/hotkeys/hotkey-settings'
import CopyButton from '../common/CopyButton.vue'
import FieldRow from '../common/FieldRow.vue'
import IconButton from '../common/IconButton.vue'
import InfoPopover from '../common/InfoPopover.vue'
import HotkeyInput from './HotkeyInput.vue'
import type { HotkeyPlatform } from '@tyco/shared'

defineProps<{
  row: GlobalHotkeyRowModel
  platform: HotkeyPlatform
  isEditable: boolean
  error?: string
  externalCommand?: string
}>()

const emit = defineEmits<{
  set: [shortcut: string]
  recording: [suspended: boolean]
}>()

const { t } = useI18n()
</script>

<style scoped>
.hotkey-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
}

.hotkey-info {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  white-space: normal;
}

.hotkey-info p {
  margin: 0;
}

.hotkey-info-title {
  font-weight: 600;
}

.external-command {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-basis: 100%;
  min-width: 0;
}

.external-command code {
  overflow-x: auto;
  overscroll-behavior: contain;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--app-surface-raised);
  font-size: var(--text-caption);
}

.hotkey-info .external-command code {
  background: var(--app-surface);
}
</style>
