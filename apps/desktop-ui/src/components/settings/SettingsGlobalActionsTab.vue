<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('settings.globalHotkeysTitle')"
      :info="globalInfo"
    >
      <template v-if="isSystemManaged" #actions>
        <Button
          size="sm"
          :variant="missing.length === 0 ? 'ghost' : 'primary'"
          icon="mdi:refresh"
          :loading="isRebinding"
          :title="t('settings.rebindHotkeysHint')"
          @click="rebindHotkeys"
        >
          {{ t('settings.rebindHotkeys') }}
        </Button>
        <Button
          v-if="canConfigure"
          size="sm"
          icon="mdi:keyboard-settings"
          @click="configureHotkeys"
        >
          {{ t('settings.configureGlobalHotkeys') }}
        </Button>
      </template>
      <InlineNotice
        v-if="missing.length > 0"
        class="provider-note"
        kind="warning"
        icon="mdi:alert-outline"
        :message="t('settings.hotkeysMissing')"
      />
      <InlineNotice
        v-if="portalError"
        class="provider-note"
        kind="error"
        icon="mdi:information-outline"
        :message="portalError"
      />
      <FieldRow
        v-for="row in rows"
        :key="row.id"
        :label="row.label"
        :error="
          hasConflict(providerState, row.id)
            ? t('settings.hotkeyStatus.conflict')
            : undefined
        "
      >
        <template #info>
          <InfoPopover
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
            :platform="providerState.platform"
            @update:model-value="setShortcut(row.id, $event)"
            @recording="suspendHotkeys"
          />
          <IconButton
            v-if="isEditable && row.value"
            size="sm"
            variant="ghost"
            icon="mdi:close"
            :label="t('settings.unassignHotkey')"
            @click="setShortcut(row.id, '')"
          />
          <IconButton
            v-if="
              isEditable && row.defaultValue && row.value !== row.defaultValue
            "
            size="sm"
            variant="ghost"
            icon="mdi:restore"
            :label="t('settings.resetToDefault')"
            @click="setShortcut(row.id, row.defaultValue)"
          />
          <p v-if="row.inline && injection.ok === false" class="hotkey-error">
            {{
              t('settings.textInjection.unavailable', {
                error: injection.error,
              })
            }}
            <Button
              size="sm"
              variant="ghost"
              icon="mdi:refresh"
              @click="checkInjection"
            >
              {{ t('settings.textInjection.recheck') }}
            </Button>
          </p>
          <div
            v-if="providerState.statuses[row.id]?.externalCommand"
            class="external-command"
          >
            <code>{{ providerState.statuses[row.id].externalCommand }}</code>
            <CopyButton
              :value="providerState.statuses[row.id].externalCommand ?? ''"
              :label="t('settings.copyHotkeyCommand')"
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
          :model-value="userConfig.editor.submitKey ?? DEFAULT_SUBMIT_KEY"
          :options="submitKeyOptions"
          @update:model-value="
            userConfig.editor.submitKey = resolveSubmitKey($event)
          "
        />
      </FieldRow>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import {
  isEditable as checkIsEditable,
  isSystemManaged as checkIsSystemManaged,
  defaultShortcut,
  displayedShortcut,
  hasConflict,
  missingHotkeys,
  modeCliCall,
  providerNoteKey,
} from '../../lib/hotkeys/hotkey-settings'
import { resolveSubmitKey } from '../../lib/input-keys/input-keys'
import { useGlobalHotkeysStore } from '../../stores/global-hotkeys'
import Button from '../common/Button.vue'
import CopyButton from '../common/CopyButton.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import IconButton from '../common/IconButton.vue'
import InfoPopover from '../common/InfoPopover.vue'
import InlineNotice from '../common/InlineNotice.vue'
import HotkeyInput from './HotkeyInput.vue'
import SettingsSection from './SettingsSection.vue'
import {
  DEFAULT_SUBMIT_KEY,
  DEFAULT_USER_CONFIG,
  type HotkeyId,
  INLINE_CORRECTION_HOTKEY_ID,
  launcherPageHotkeyId,
  launcherPageMode,
} from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig, operations } = useSettingsContext()

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
  'voiceCommands',
  'select',
  'aiTasks',
  'correction',
  'translate',
]

interface HotkeyRow {
  /** The id `applyHotkey` takes: a mode, a `replace.` action or a page */
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

const hotkeysStore = useGlobalHotkeysStore()
const { portalError, isRebinding } = storeToRefs(hotkeysStore)
const { providerState, injection } = hotkeysStore
const canConfigure = computed(() => providerState.canConfigure)
const isEditable = computed(() => checkIsEditable(providerState))
const isSystemManaged = computed(() => checkIsSystemManaged(providerState))
const providerNote = computed(() => providerNoteKey(providerState))
const globalInfo = computed(() =>
  [t('settings.globalActionsHint'), providerNote.value && t(providerNote.value)]
    .filter(Boolean)
    .join('\n\n')
)

const modes = (Object.keys(DEFAULT_USER_CONFIG.hotkeys) as HotkeyId[])
  .filter((id) => id !== 'selectionCorrection')
  .sort(
    (a, b) =>
      (MODE_ORDER.indexOf(a) + 1 || Infinity) -
      (MODE_ORDER.indexOf(b) + 1 || Infinity)
  )
const inlineId = INLINE_CORRECTION_HOTKEY_ID

const rows = computed<HotkeyRow[]>(() => [
  ...modes.map((mode) => ({
    id: mode,
    label: t(`settings.hotkeyActions.${mode}`),
    value: displayedShortcut(
      providerState,
      mode,
      userConfig.value.hotkeys[mode] ?? ''
    ),
    defaultValue: defaultShortcut(
      providerState,
      mode,
      DEFAULT_USER_CONFIG.hotkeys[mode]
    ),
    command: modeCliCall(mode),
    externalHint: t('settings.externalMethodsHint'),
  })),
  {
    id: inlineId,
    label: t('settings.hotkeyActions.inlineCorrection'),
    value: displayedShortcut(
      providerState,
      inlineId,
      userConfig.value.hotkeys.selectionCorrection
    ),
    defaultValue: defaultShortcut(
      providerState,
      inlineId,
      DEFAULT_USER_CONFIG.hotkeys.selectionCorrection
    ),
    command: 'tyco-ctl replace correction',
    externalHint: t('settings.inlineCorrectionExternalHint'),
    description: t('settings.inlineCorrectionHint'),
    inline: true,
  },
  ...userConfig.value.launcherPages.map((page, index) => {
    const id = launcherPageHotkeyId(page.id)
    return {
      id,
      label: t('settings.launcherPage', { page: index + 1 }),
      value: displayedShortcut(providerState, id, page.hotkey),
      defaultValue: defaultShortcut(providerState, id, ''),
      command: `tyco --mode=${launcherPageMode(page.id)}`,
      externalHint: t('settings.externalMethodsHint'),
    }
  }),
])

function setShortcut(mode: string, shortcut: string) {
  // Native registration and persistence are one backend transaction.
  operations.updateHotkey(mode, shortcut)
}

// pressing a bound shortcut must reach the field, not run its action
function suspendHotkeys(suspended: boolean) {
  hotkeysStore.suspendHotkeys(suspended)
}

async function checkInjection() {
  await hotkeysStore.checkTextInjection()
}

const missing = computed(() =>
  missingHotkeys(
    providerState,
    rows.value.map((row) => row.id)
  )
)

async function configureHotkeys() {
  await hotkeysStore.configureHotkeys(t('settings.configureHotkeysError'))
}

// the backend reports the new shortcuts with the hotkeys changed event
async function rebindHotkeys() {
  await hotkeysStore.rebindHotkeys(t('settings.rebindHotkeysError'))
}

onMounted(async () => {
  void checkInjection()
  await hotkeysStore.reload()
})
</script>

<style scoped>
.provider-note {
  padding: var(--space-md) var(--space-lg);
  border-bottom: 1px solid var(--app-border-subtle);
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
  font-size: var(--text-caption);
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
  font-size: var(--text-caption);
}

.hotkey-info .external-command code {
  background: var(--app-surface);
}
</style>
