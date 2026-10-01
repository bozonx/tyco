<template>
  <div class="flex flex-col gap-6">
    <SettingsSection
      :title="t('settings.globalActionsTab')"
      :description="t('settings.globalActionsHint')"
    >
      <div v-if="canConfigure" class="configure-hotkeys">
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
          <details class="external-methods">
            <summary>{{ t('settings.externalMethods') }}</summary>
            <p>{{ t('settings.externalMethodsHint') }}</p>
            <div class="external-command">
              <code>{{ activationCommand(action.mode) }}</code>
              <Button
                sm
                ghost
                icon="mdi:content-copy"
                @click="copyActivationCommand(action.mode)"
              >
                {{ t('settings.copyActivationCommand') }}
              </Button>
            </div>
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
          </details>
        </div>
      </FieldRow>
    </SettingsSection>

    <SettingsSection
      :title="t('settings.selectionActions.title')"
      :description="t('settings.selectionActions.hint')"
    >
      <div class="injection-status" :data-ok="injection.ok">
        <span>
          {{
            injection.ok === null
              ? t('settings.selectionActions.checking')
              : injection.ok
                ? t('settings.selectionActions.ready')
                : t('settings.selectionActions.unavailable', {
                    error: injection.error,
                  })
          }}
        </span>
        <Button sm ghost icon="mdi:refresh" @click="checkInjection">
          {{ t('settings.selectionActions.recheck') }}
        </Button>
      </div>
      <FieldRow :label="t('settings.selectionActions.whenEmpty')">
        <FieldSelect
          class="w-full"
          :value="userConfig.selectionReplace?.whenEmpty ?? 'nothing'"
          :options="whenEmptyOptions"
          @update:value="emit('update:selectionWhenEmpty', String($event))"
        />
      </FieldRow>
      <FieldRow
        v-for="action in selectionActions"
        :key="action.id"
        :label="selectionActionLabel(action)"
      >
        <div class="hotkey-control">
          <input
            class="input hotkey-input"
            :value="selectionShortcut(action.id)"
            :placeholder="t('settings.selectionActions.notAssigned')"
            :aria-label="selectionActionLabel(action)"
            readonly
            @focus="recordingMode = selectionTarget(action.id)"
            @blur="recordingMode = null"
            @keydown="record($event, selectionTarget(action.id))"
          />
          <Button
            sm
            neutral
            :disabled="!selectionShortcut(action.id)"
            @click="clearSelectionShortcut(action.id)"
          >
            {{ t('settings.selectionActions.clear') }}
          </Button>
          <Button
            v-if="action.defaultShortcut"
            sm
            neutral
            :disabled="selectionShortcut(action.id) === action.defaultShortcut"
            @click="
              setShortcut(selectionTarget(action.id), action.defaultShortcut)
            "
          >
            {{ t('settings.resetToDefault') }}
          </Button>
          <p
            class="hotkey-status"
            :data-status="statuses[selectionTarget(action.id)]?.status"
          >
            {{ statusText(selectionTarget(action.id)) }}
          </p>
          <details class="external-methods">
            <summary>{{ t('settings.externalMethods') }}</summary>
            <p>{{ t('settings.selectionActions.externalHint') }}</p>
            <div class="external-command">
              <code>{{ replaceCommand(action.id) }}</code>
              <Button
                sm
                ghost
                icon="mdi:content-copy"
                @click="copyText(replaceCommand(action.id))"
              >
                {{ t('settings.copyActivationCommand') }}
              </Button>
            </div>
          </details>
        </div>
      </FieldRow>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRef } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { applyProviderInfo } from '../../lib/hotkeys/hotkey-settings'
import { getLanguageLabel } from '../../lib/locale/language'
import {
  type SelectionActionEntry,
  listSelectionActions,
} from '../../lib/selection-replace/selection-action-list'
import { useIpcStore } from '../../stores/ipc'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import SettingsSection from '../common/SettingsSection.vue'
import {
  DEFAULT_USER_CONFIG,
  type HotkeyApplyResult,
  type HotkeyProviderInfo,
  SELECTION_HOTKEY_PREFIX,
  type UserConfig,
  hotkeyFromKeyboardEvent,
} from '@tyco/shared'

const props = defineProps<{ userConfig: UserConfig }>()
const emit = defineEmits<{
  (event: 'update:hotkey', mode: string, shortcut: string): void
  (event: 'update:selectionWhenEmpty', value: string): void
}>()
const { t } = useI18n()

const activationCommand = (mode: string) => `tyco-ctl activate ${mode}`
async function copyActivationCommand(mode: string) {
  await navigator.clipboard.writeText(activationCommand(mode))
}

const ipcStore = useIpcStore()
const recordingMode = ref<string | null>(null)
const providerState = reactive({
  canConfigure: false,
  statuses: {} as Record<string, HotkeyApplyResult>,
})
const canConfigure = toRef(providerState, 'canConfigure')
const statuses = toRef(providerState, 'statuses')
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

const selectionActions = computed(() =>
  listSelectionActions(props.userConfig, DEFAULT_USER_CONFIG.selectionHotkeys)
)
const whenEmptyOptions = computed(() => [
  { id: 'nothing', name: t('settings.selectionActions.whenEmptyNothing') },
  { id: 'selectAll', name: t('settings.selectionActions.whenEmptySelectAll') },
])
const injection = reactive<{ ok: boolean | null; error: string }>({
  ok: null,
  error: '',
})

const selectionTarget = (id: string) => `${SELECTION_HOTKEY_PREFIX}${id}`
const selectionShortcut = (id: string) =>
  props.userConfig.selectionHotkeys?.[id] ?? ''
const replaceCommand = (id: string) => `tyco-ctl replace ${id}`

function selectionActionLabel(action: SelectionActionEntry) {
  switch (action.kind) {
    case 'translate':
      return t('settings.selectionActions.translate', {
        language: t(getLanguageLabel(action.language ?? '')),
      })
    case 'aiTask':
      return t('settings.selectionActions.aiTask', {
        name: action.taskName ?? '',
      })
    default:
      return t('settings.selectionActions.correction')
  }
}

function clearSelectionShortcut(id: string) {
  delete statuses.value[selectionTarget(id)]
  emit('update:hotkey', selectionTarget(id), '')
}

async function copyText(text: string) {
  await navigator.clipboard.writeText(text)
}

async function checkInjection() {
  injection.ok = null
  const result = await ipcStore.callFunction('checkTextInjection')
  injection.ok = result.success
  injection.error = result.error ?? ''
}

async function configureHotkeys() {
  configureError.value = ''
  const result = await ipcStore.callFunction('configureHotkeys')
  if (!result.success) {
    configureError.value = result.error || t('settings.configureHotkeysError')
  }
}

onMounted(async () => {
  void checkInjection()
  const result = await ipcStore.callFunction('getHotkeyProviderInfo')
  if (result.success) {
    applyProviderInfo(providerState, result.result as HotkeyProviderInfo)
  }
})
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

.external-methods {
  flex-basis: 100%;
}

.external-methods summary {
  cursor: pointer;
}

.external-command {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-basis: 100%;
  min-width: 0;
}

.injection-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  margin-bottom: var(--space-md);
  color: var(--app-text-muted);
  font-size: 0.875rem;
}

.injection-status[data-ok='false'] {
  color: var(--app-error);
}

.external-command code {
  overflow-x: auto;
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--app-surface-raised);
}
</style>
