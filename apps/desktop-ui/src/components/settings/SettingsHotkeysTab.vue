<template>
  <SettingsSection
    :title="t('settings.hotkeysTitle')"
    :description="t('settings.hotkeysHint')"
  >
    <div class="configure-hotkeys">
      <Button icon="mdi:keyboard-settings" @click="configureHotkeys">
        {{ t('settings.configureGlobalHotkeys') }}
      </Button>
      <p v-if="configureError" class="configure-error">
        {{ configureError }}
      </p>
    </div>
    <FieldRow
      v-for="action in actions"
      :key="action.mode"
      :label="t(`settings.hotkeyActions.${action.mode}`)"
    >
      <div class="hotkey-control">
        <input
          class="input hotkey-input"
          :value="userConfig.hotkeys[action.mode]"
          :aria-label="t(`settings.hotkeyActions.${action.mode}`)"
          readonly
          @focus="recordingMode = action.mode"
          @blur="recordingMode = null"
          @keydown="record($event, action.mode)"
        />
        <Button
          sm
          neutral
          :disabled="userConfig.hotkeys[action.mode] === action.defaultValue"
          @click="setShortcut(action.mode, action.defaultValue)"
        >
          {{ t('settings.resetToDefault') }}
        </Button>
        <p class="hotkey-status" :data-status="statuses[action.mode]?.status">
          {{ statusText(action.mode) }}
        </p>
        <div
          v-if="statuses[action.mode]?.externalCommand"
          class="external-command"
        >
          <code>{{ statuses[action.mode].externalCommand }}</code>
          <Button
            sm
            ghost
            icon="mdi:content-copy"
            @click="copyCommand(action.mode)"
          >
            {{ t('settings.copyHotkeyCommand') }}
          </Button>
        </div>
      </div>
    </FieldRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { useIpcStore } from '../../stores/ipc'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import SettingsSection from '../common/SettingsSection.vue'
import {
  DEFAULT_USER_CONFIG,
  type HotkeyApplyResult,
  type UserConfig,
  hotkeyFromKeyboardEvent,
} from '@tyco/shared'

defineProps<{ userConfig: UserConfig }>()
const emit = defineEmits<{
  (event: 'update:hotkey', mode: string, shortcut: string): void
}>()
const { t } = useI18n()
const ipcStore = useIpcStore()
const recordingMode = ref<string | null>(null)
const statuses = ref<Record<string, HotkeyApplyResult>>({})
const configureError = ref('')

const actions = Object.entries(DEFAULT_USER_CONFIG.hotkeys).map(
  ([mode, defaultValue]) => ({ mode, defaultValue })
)

async function record(event: KeyboardEvent, mode: string) {
  event.preventDefault()
  event.stopPropagation()
  const shortcut = hotkeyFromKeyboardEvent(event)
  if (shortcut) await setShortcut(mode, shortcut)
}

async function setShortcut(mode: string, shortcut: string) {
  const result = await ipcStore.callFunction('applyHotkey', [
    { mode, shortcut },
  ])
  const status: HotkeyApplyResult = result.success
    ? (result.result as HotkeyApplyResult)
    : { status: 'conflict', message: result.error }
  statuses.value[mode] = status
  if (status.status !== 'conflict') emit('update:hotkey', mode, shortcut)
}

function statusText(mode: string) {
  if (recordingMode.value === mode) return t('settings.hotkeyRecording')
  const result = statuses.value[mode]
  return result ? t(`settings.hotkeyStatus.${result.status}`) : ''
}

async function copyCommand(mode: string) {
  const command = statuses.value[mode]?.externalCommand
  if (command) await navigator.clipboard.writeText(command)
}

async function configureHotkeys() {
  configureError.value = ''
  const result = await ipcStore.callFunction('configureHotkeys')
  if (!result.success) {
    configureError.value = result.error || t('settings.configureHotkeysError')
  }
}
</script>

<style scoped>
.configure-hotkeys {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
}

.configure-error {
  margin: 0;
  color: var(--app-error);
  font-size: 0.75rem;
}

.hotkey-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
}

.hotkey-input {
  flex: 1;
  min-width: 12rem;
  cursor: pointer;
}

.hotkey-input:focus {
  outline: 2px solid var(--app-accent);
  outline-offset: 1px;
}

.hotkey-status {
  flex-basis: 100%;
  min-height: 1.25rem;
  margin: 0;
  color: var(--app-text-muted);
  font-size: 0.75rem;
}

.hotkey-status[data-status='conflict'] {
  color: var(--app-error);
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
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--app-surface-raised);
}
</style>
