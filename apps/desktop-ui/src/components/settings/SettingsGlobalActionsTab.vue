<template>
  <div class="flex flex-col gap-6">
    <SettingsSection
      :title="t('settings.globalHotkeysTitle')"
      :info="globalInfo"
    >
      <template v-if="systemManaged" #actions>
        <Button
          sm
          :ghost="missing.length === 0"
          icon="mdi:refresh"
          :disabled="rebinding"
          :title="t('settings.rebindHotkeysHint')"
          @click="rebindHotkeys"
        >
          {{ t('settings.rebindHotkeys') }}
        </Button>
        <Button
          v-if="canConfigure"
          sm
          icon="mdi:keyboard-settings"
          @click="configureHotkeys"
        >
          {{ t('settings.configureGlobalHotkeys') }}
        </Button>
      </template>
      <div v-if="missing.length > 0" class="provider-note missing-note">
        <Icon icon="mdi:alert-outline" height="16" class="shrink-0" />
        <p>{{ t('settings.hotkeysMissing') }}</p>
      </div>
      <div v-if="portalError" class="provider-note">
        <Icon icon="mdi:information-outline" height="16" class="shrink-0" />
        <div>
          <p class="portal-error">
            {{ portalError }}
          </p>
        </div>
      </div>
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
            :readonly="!editable"
            :platform="providerState.platform"
            @record="setShortcut(row.id, $event)"
            @recording="suspendHotkeys"
          />
          <Button
            v-if="editable && row.value"
            sm
            ghost
            square
            icon="mdi:close"
            :title="t('settings.unassignHotkey')"
            :aria-label="t('settings.unassignHotkey')"
            @click="setShortcut(row.id, '')"
          />
          <Button
            v-if="
              editable && row.defaultValue && row.value !== row.defaultValue
            "
            sm
            ghost
            square
            icon="mdi:restore"
            :title="t('settings.resetToDefault')"
            :aria-label="t('settings.resetToDefault')"
            @click="setShortcut(row.id, row.defaultValue)"
          />
          <p v-if="hasConflict(providerState, row.id)" class="hotkey-error">
            {{ t('settings.hotkeyStatus.conflict') }}
          </p>
          <p v-if="row.inline && injection.ok === false" class="hotkey-error">
            {{
              t('settings.textInjection.unavailable', {
                error: injection.error,
              })
            }}
            <Button sm ghost icon="mdi:refresh" @click="checkInjection">
              {{ t('settings.textInjection.recheck') }}
            </Button>
          </p>
          <div
            v-if="providerState.statuses[row.id]?.externalCommand"
            class="external-command"
          >
            <code>{{ providerState.statuses[row.id].externalCommand }}</code>
            <Button
              sm
              ghost
              square
              icon="mdi:content-copy"
              :title="t('settings.copyHotkeyCommand')"
              :aria-label="t('settings.copyHotkeyCommand')"
              @click="
                copyText(providerState.statuses[row.id].externalCommand ?? '')
              "
            />
          </div>
        </div>
      </FieldRow>
    </SettingsSection>

    <SettingsSection
      :title="t('settings.appHotkeysTitle')"
      :info="t('settings.appHotkeysHint')"
    >
      <FieldRow :label="t('settings.submitKey.label')">
        <FieldSelect
          :value="userConfig.submitKey ?? DEFAULT_SUBMIT_KEY"
          :options="submitKeyOptions"
          @update:value="emit('update:submit-key', resolveSubmitKey($event))"
        />
      </FieldRow>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { desktopClient } from '../../lib/desktop/client'
import {
  applyProviderInfo,
  createHotkeySettingsState,
  defaultShortcut,
  displayedShortcut,
  hasConflict,
  isEditable,
  isSystemManaged,
  missingHotkeys,
  providerNoteKey,
} from '../../lib/hotkeys/hotkey-settings'
import { resolveSubmitKey } from '../../lib/input-keys/input-keys'
import { useIpcStore } from '../../stores/ipc'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import HotkeyInput from '../common/HotkeyInput.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import SettingsSection from '../common/SettingsSection.vue'
import { Icon } from '@iconify/vue'
import {
  DEFAULT_SUBMIT_KEY,
  DEFAULT_USER_CONFIG,
  DESKTOP_EVENTS,
  type HotkeyApplyResult,
  type HotkeyProviderInfo,
  SELECTION_HOTKEY_PREFIX,
  type SubmitKey,
  type UserConfig,
} from '@tyco/shared'

const props = defineProps<{ userConfig: UserConfig }>()
const emit = defineEmits<{
  (event: 'update:hotkey', mode: string, shortcut: string): void
  (event: 'update:submit-key', value: SubmitKey): void
}>()
const { t } = useI18n()

const submitKeyOptions = computed(() => [
  { id: 'enter', name: t('settings.submitKey.enter') },
  { id: 'ctrlEnter', name: t('settings.submitKey.ctrlEnter') },
])

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
  'translate',
  'commandLauncher',
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
const providerState = reactive(createHotkeySettingsState())
const canConfigure = computed(() => providerState.canConfigure)
const editable = computed(() => isEditable(providerState))
const systemManaged = computed(() => isSystemManaged(providerState))
const providerNote = computed(() => providerNoteKey(providerState))
const globalInfo = computed(() =>
  [t('settings.globalActionsHint'), providerNote.value && t(providerNote.value)]
    .filter(Boolean)
    .join('\n\n')
)
const portalError = ref('')
const rebinding = ref(false)
const injection = reactive<{ ok: boolean | null; error: string }>({
  ok: null,
  error: '',
})

const modes = Object.keys(DEFAULT_USER_CONFIG.hotkeys).sort(
  (a, b) =>
    (MODE_ORDER.indexOf(a) + 1 || Infinity) -
    (MODE_ORDER.indexOf(b) + 1 || Infinity)
)
const inlineId = `${SELECTION_HOTKEY_PREFIX}${INLINE_CORRECTION}`

const rows = computed<HotkeyRow[]>(() => [
  ...modes.map((mode) => ({
    id: mode,
    label: t(`settings.hotkeyActions.${mode}`),
    value: displayedShortcut(
      providerState,
      mode,
      props.userConfig.hotkeys[mode] ?? ''
    ),
    defaultValue: defaultShortcut(
      providerState,
      mode,
      DEFAULT_USER_CONFIG.hotkeys[mode]
    ),
    command: `tyco-ctl activate ${mode}`,
    externalHint: t('settings.externalMethodsHint'),
  })),
  {
    id: inlineId,
    label: t('settings.hotkeyActions.inlineCorrection'),
    value: displayedShortcut(
      providerState,
      inlineId,
      props.userConfig.selectionHotkeys?.[INLINE_CORRECTION] ??
        DEFAULT_USER_CONFIG.selectionHotkeys[INLINE_CORRECTION]
    ),
    defaultValue: defaultShortcut(
      providerState,
      inlineId,
      DEFAULT_USER_CONFIG.selectionHotkeys[INLINE_CORRECTION]
    ),
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
  providerState.statuses[mode] = status
  if (status.status !== 'conflict') emit('update:hotkey', mode, shortcut)
}

// pressing a bound shortcut must reach the field, not run its action
function suspendHotkeys(suspended: boolean) {
  void ipcStore.callFunction('suspendHotkeys', [suspended])
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

const missing = computed(() =>
  missingHotkeys(
    providerState,
    rows.value.map((row) => row.id)
  )
)

async function configureHotkeys() {
  portalError.value = ''
  const result = await ipcStore.callFunction('configureHotkeys')
  if (!result.success) {
    portalError.value = result.error || t('settings.configureHotkeysError')
  }
}

// the backend reports the new shortcuts with the hotkeys changed event
async function rebindHotkeys() {
  portalError.value = ''
  rebinding.value = true
  const result = await ipcStore.callFunction('rebindHotkeys')
  rebinding.value = false
  if (!result.success) {
    portalError.value = result.error || t('settings.rebindHotkeysError')
  }
}

async function loadProviderInfo() {
  const result = await ipcStore.callFunction('getHotkeyProviderInfo')
  if (result.success) {
    applyProviderInfo(providerState, result.result as HotkeyProviderInfo)
  }
}

let unlistenHotkeysChanged: (() => void) | undefined
let unmounted = false

onMounted(async () => {
  void checkInjection()
  const unlisten = await desktopClient.listen(
    DESKTOP_EVENTS.HOTKEYS_CHANGED,
    () => void loadProviderInfo()
  )
  if (unmounted) unlisten()
  else unlistenHotkeysChanged = unlisten
  await loadProviderInfo()
})

onBeforeUnmount(() => {
  unmounted = true
  unlistenHotkeysChanged?.()
})
</script>

<style scoped>
.provider-note {
  display: flex;
  gap: var(--space-sm);
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--app-border-subtle);
  color: var(--app-text-muted);
  font-size: 0.8125rem;
  line-height: 1.45;
}

.provider-note p {
  margin: 0;
}

.portal-error {
  color: var(--app-error);
}

.missing-note {
  color: var(--color-warning);
}

.missing-note p {
  margin: 0;
}

.hotkey-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
}

.hotkey-error {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  flex-basis: 100%;
  margin: 0;
  color: var(--app-error);
  font-size: 0.75rem;
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
  background: var(--app-surface-raised);
  font-size: 0.75rem;
}

.hotkey-info .external-command code {
  background: var(--app-surface);
}
</style>
