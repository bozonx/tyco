<template>
  <div class="flex flex-col gap-6">
    <SettingsSection>
      <template v-if="canConfigure" #actions>
        <Button sm icon="mdi:keyboard-settings" @click="configureHotkeys">
          {{ t('settings.configureGlobalHotkeys') }}
        </Button>
      </template>
      <p v-if="configureError" class="configure-error">
        {{ configureError }}
      </p>
      <FieldRow v-for="row in rows" :key="row.id" :label="row.label">
        <template #info>
          <InfoTooltip
            :aria-label="t('settings.externalMethods')"
            align="start"
          >
            <div class="hotkey-info">
              <p v-if="row.description">{{ row.description }}</p>
              <p class="hotkey-info-title">
                {{ t('settings.externalMethods') }}
              </p>
              <p>{{ row.externalHint }}</p>
              <div class="external-command">
                <code>{{ row.command }}</code>
                <Button
                  sm
                  ghost
                  square
                  icon="mdi:content-copy"
                  :title="t('settings.copyActivationCommand')"
                  :aria-label="t('settings.copyActivationCommand')"
                  @click="copyText(row.command)"
                />
              </div>
            </div>
          </InfoTooltip>
        </template>
        <div class="hotkey-control">
          <HotkeyInput
            :value="row.value"
            :aria-label="row.label"
            :placeholder="t('settings.hotkeyNotAssigned')"
            @record="setShortcut(row.id, $event)"
          />
          <Button
            v-if="row.value !== row.defaultValue"
            sm
            ghost
            square
            icon="mdi:restore"
            :title="t('settings.resetToDefault')"
            :aria-label="t('settings.resetToDefault')"
            @click="setShortcut(row.id, row.defaultValue)"
          />
          <p
            v-if="row.inline && injection.ok === false"
            class="hotkey-status"
            data-status="conflict"
          >
            {{
              t('settings.textInjection.unavailable', {
                error: injection.error,
              })
            }}
            <Button sm ghost icon="mdi:refresh" @click="checkInjection">
              {{ t('settings.textInjection.recheck') }}
            </Button>
          </p>
          <p
            v-else-if="statuses[row.id]"
            class="hotkey-status"
            :data-status="statuses[row.id].status"
          >
            {{ t(`settings.hotkeyStatus.${statuses[row.id].status}`) }}
          </p>
          <div
            v-if="statuses[row.id]?.externalCommand"
            class="external-command"
          >
            <code>{{ statuses[row.id].externalCommand }}</code>
            <Button
              sm
              ghost
              icon="mdi:content-copy"
              @click="copyText(statuses[row.id].externalCommand ?? '')"
            >
              {{ t('settings.copyHotkeyCommand') }}
            </Button>
          </div>
        </div>
      </FieldRow>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, toRef } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { applyProviderInfo } from '../../lib/hotkeys/hotkey-settings'
import { useIpcStore } from '../../stores/ipc'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import HotkeyInput from '../common/HotkeyInput.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import SettingsSection from '../common/SettingsSection.vue'
import {
  DEFAULT_USER_CONFIG,
  type HotkeyApplyResult,
  type HotkeyProviderInfo,
  SELECTION_HOTKEY_PREFIX,
  type UserConfig,
} from '@tyco/shared'

const props = defineProps<{ userConfig: UserConfig }>()
const emit = defineEmits<{
  (event: 'update:hotkey', mode: string, shortcut: string): void
}>()
const { t } = useI18n()

/** Display order of the activation modes; unknown modes go last. */
const MODE_ORDER = [
  'write',
  'voice',
  'editor',
  'chat',
  'voiceChat',
  'select',
  'aiTasks',
  'correction',
]
const INLINE_CORRECTION = 'correction'

interface HotkeyRow {
  /** The id `applyHotkey` takes: a mode or a `replace.` action */
  id: string
  label: string
  value: string
  defaultValue: string
  command: string
  externalHint: string
  description?: string
  /** Replaces the selection in place and needs text injection */
  inline?: boolean
}

const ipcStore = useIpcStore()
const providerState = reactive({
  canConfigure: false,
  statuses: {} as Record<string, HotkeyApplyResult>,
})
const canConfigure = toRef(providerState, 'canConfigure')
const statuses = toRef(providerState, 'statuses')
const configureError = ref('')
const injection = reactive<{ ok: boolean | null; error: string }>({
  ok: null,
  error: '',
})

const modes = Object.keys(DEFAULT_USER_CONFIG.hotkeys).sort(
  (a, b) =>
    (MODE_ORDER.indexOf(a) + 1 || Infinity) -
    (MODE_ORDER.indexOf(b) + 1 || Infinity)
)

const rows = computed<HotkeyRow[]>(() => [
  ...modes.map((mode) => ({
    id: mode,
    label: t(`settings.hotkeyActions.${mode}`),
    value: props.userConfig.hotkeys[mode] ?? '',
    defaultValue: DEFAULT_USER_CONFIG.hotkeys[mode],
    command: `tyco-ctl activate ${mode}`,
    externalHint: t('settings.externalMethodsHint'),
  })),
  {
    id: `${SELECTION_HOTKEY_PREFIX}${INLINE_CORRECTION}`,
    label: t('settings.hotkeyActions.inlineCorrection'),
    value:
      props.userConfig.selectionHotkeys?.[INLINE_CORRECTION] ??
      DEFAULT_USER_CONFIG.selectionHotkeys[INLINE_CORRECTION],
    defaultValue: DEFAULT_USER_CONFIG.selectionHotkeys[INLINE_CORRECTION],
    command: `tyco-ctl replace ${INLINE_CORRECTION}`,
    externalHint: t('settings.inlineCorrectionExternalHint'),
    description: t('settings.inlineCorrectionHint'),
    inline: true,
  },
])

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
.configure-error {
  margin: 0;
  padding: var(--space-sm) var(--space-lg) 0;
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

.hotkey-status {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-basis: 100%;
  margin: 0;
  color: var(--app-text-muted);
  font-size: 0.75rem;
}

.hotkey-status[data-status='conflict'] {
  color: var(--app-error);
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
  padding: var(--space-xs) var(--space-sm);
  border-radius: var(--radius-sm);
  background: var(--app-surface);
}
</style>
