<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('settings.globalHotkeysTitle')"
      :info="globalInfo"
      device-scoped
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
      <div v-for="group in generalGroups" :key="group.id" class="hotkey-group">
        <div class="hotkey-group-header">
          <span class="hotkey-group-title">{{ group.label }}</span>
        </div>
        <GlobalHotkeyRow
          v-for="row in group.rows"
          :id="`hotkey-${row.id}`"
          :key="row.id"
          :row="row"
          :platform="providerState.platform"
          :is-editable="isEditable"
          :error="rowError(row.id)"
          :external-command="providerState.statuses[row.id]?.externalCommand"
          @set="setShortcut(row.id, $event)"
          @recording="suspendHotkeys"
        />
      </div>
    </SettingsSection>

    <SettingsSection
      v-if="voiceRows.length > 0"
      :title="t('settings.voiceHotkeysTitle')"
      :info="t('settings.voiceHotkeysInfo')"
      device-scoped
    >
      <div v-for="row in voiceRows" :key="row.id" class="voice-hotkey-item">
        <GlobalHotkeyRow
          :id="`hotkey-${row.id}`"
          :row="row"
          :platform="providerState.platform"
          :is-editable="isEditable"
          :error="rowError(row.id)"
          :external-command="providerState.statuses[row.id]?.externalCommand"
          @set="setShortcut(row.id, $event)"
          @recording="suspendHotkeys"
        />
        <FieldRow
          v-if="isHoldSupported && holdToggles[row.id]"
          class="voice-hold-row"
          nested
          :separator="false"
          :label="holdToggles[row.id].label"
          :info="holdToggles[row.id].info"
        >
          <FieldSwitch
            :model-value="userConfig.stt[holdToggles[row.id].setting]"
            @update:model-value="
              userConfig.stt[holdToggles[row.id].setting] = $event
            "
          />
        </FieldRow>
      </div>
    </SettingsSection>

    <SettingsSection
      :title="t('settings.customActionsTitle')"
      :info="t('settings.customActionsInfo')"
      device-scoped
    >
      <div
        v-for="(slot, index) in customActionSlots"
        :key="index"
        class="custom-action-slot"
      >
        <FieldRow
          :label="t('settings.customActionSlot', { index: index + 1 })"
          :error="rowError(customActionHotkeyRow(index).id)"
        >
          <template #info>
            <InfoPopover
              :aria-label="t('settings.externalMethods')"
              align="start"
            >
              <div class="hotkey-info">
                <p class="hotkey-info-title">
                  {{ t('settings.externalMethods') }}
                </p>
                <p>{{ t('settings.externalMethodsHint') }}</p>
                <div class="external-command">
                  <code>{{ customActionHotkeyRow(index).command }}</code>
                  <CopyButton
                    :value="customActionHotkeyRow(index).command"
                    :label="t('settings.copyActivationCommand')"
                  />
                </div>
              </div>
            </InfoPopover>
          </template>
          <div class="custom-action-controls">
            <FieldSelect
              class="custom-action-select"
              :model-value="optionId(slot.action)"
              :options="customActionOptions"
              @update:model-value="updateCustomAction(index, $event)"
            />
            <FieldSwitch
              :model-value="slotTakesSelection(index)"
              :disabled="slotBehavior(index).disabled"
              :label="t('settings.customActionTakesSelection')"
              @update:model-value="setSlotTakesSelection(index, $event)"
            />
            <div class="hotkey-control custom-action-hotkey">
              <HotkeyInput
                :model-value="customActionHotkeyRow(index).value"
                :aria-label="customActionHotkeyRow(index).label"
                :placeholder="t('settings.hotkeyNotAssigned')"
                :readonly="!isEditable"
                :platform="providerState.platform"
                @update:model-value="
                  setShortcut(customActionHotkeyRow(index).id, $event)
                "
                @recording="suspendHotkeys"
              />
              <IconButton
                v-if="isEditable && customActionHotkeyRow(index).value"
                size="sm"
                variant="ghost"
                icon="mdi:close"
                :label="t('settings.unassignHotkey')"
                @click="setShortcut(customActionHotkeyRow(index).id, '')"
              />
            </div>
          </div>
        </FieldRow>
      </div>
    </SettingsSection>

    <SettingsSection
      :title="t('settings.appHotkeysTitle')"
      :info="`${t('settings.submitKey.enter')} · ${t('settings.submitKey.ctrlEnter')}`"
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
    <EditorShortcutsSettings />
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useMainActionChoices } from '../../composables/use-main-action-choices'
import { useSettingsContext } from '../../composables/use-settings-context'
import { resolveActionSelectionBehavior } from '../../lib/action-menu/action-selection-behavior'
import {
  type GlobalHotkeyRowModel,
  VOICE_HOTKEY_IDS,
  activationCommand,
  isEditable as checkIsEditable,
  isSystemManaged as checkIsSystemManaged,
  defaultShortcut,
  displayedShortcut,
  duplicateHotkey,
  hasConflict,
  isVoiceHotkey,
  missingHotkeys,
  providerNoteKey,
} from '../../lib/hotkeys/hotkey-settings'
import { resolveSubmitKey } from '../../lib/input-keys/input-keys'
import { useGlobalHotkeysStore } from '../../stores/global-hotkeys'
import Button from '../common/Button.vue'
import CopyButton from '../common/CopyButton.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import IconButton from '../common/IconButton.vue'
import InfoPopover from '../common/InfoPopover.vue'
import InlineNotice from '../common/InlineNotice.vue'
import EditorShortcutsSettings from './EditorShortcutsSettings.vue'
import GlobalHotkeyRow from './GlobalHotkeyRow.vue'
import HotkeyInput from './HotkeyInput.vue'
import SettingsSection from './SettingsSection.vue'
import {
  CUSTOM_ACTION_HOTKEY_IDS,
  DEFAULT_SUBMIT_KEY,
  DEFAULT_USER_CONFIG,
  type HotkeyId,
  INLINE_CORRECTION_HOTKEY_ID,
  type MainActionConfig,
  PRIMARY_HOTKEY_IDS,
  type SubmitKey,
} from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig, operations } = useSettingsContext()

const submitKeyOptions = computed((): { id: SubmitKey; name: string }[] => [
  { id: 'Enter', name: t('settings.submitKey.enter') },
  { id: 'Ctrl+Enter', name: t('settings.submitKey.ctrlEnter') },
])

/** Display order of the activation modes; unknown modes go last. */
const MODE_ORDER: HotkeyId[] = [
  'quickInput',
  'voice',
  'editor',
  'voiceCommands',
  'listen',
  'selectionActions',
  'quickAiRequest',
  'voiceQuickAiRequest',
  'screenshotQuickAiRequest',
  'voiceScreenshotQuickAiRequest',
  'selectionCorrection',
  'correction',
  'translation',
  'styling',
  'transformation',
  'chatPrompts',
  'favorites',
  'history',
  'selectionActionsPage2',
  'selectionActionsPage3',
  'selectionActionsPage4',
  'selectionActionsPage5',
]

const GENERAL_HOTKEY_GROUPS: readonly {
  id: string
  labelKey: string
  hotkeyIds: readonly HotkeyId[]
}[] = [
  {
    id: 'primary',
    labelKey: 'settings.hotkeyGroups.primary',
    hotkeyIds: [
      'quickInput',
      'selectionActions',
      'selectionCorrection',
      'history',
      'editor',
    ],
  },
  {
    id: 'ai',
    labelKey: 'settings.hotkeyGroups.ai',
    hotkeyIds: ['quickAiRequest', 'screenshotQuickAiRequest'],
  },
  {
    id: 'text',
    labelKey: 'settings.hotkeyGroups.text',
    hotkeyIds: ['correction', 'translation', 'styling', 'transformation'],
  },
  {
    id: 'tools',
    labelKey: 'settings.hotkeyGroups.tools',
    hotkeyIds: ['chatPrompts', 'favorites'],
  },
  {
    id: 'actionPages',
    labelKey: 'settings.hotkeyGroups.actionPages',
    hotkeyIds: [
      'selectionActionsPage2',
      'selectionActionsPage3',
      'selectionActionsPage4',
      'selectionActionsPage5',
    ],
  },
]

type HotkeyRow = GlobalHotkeyRowModel

const hotkeysStore = useGlobalHotkeysStore()
const { portalError, isRebinding } = storeToRefs(hotkeysStore)
const { providerState } = hotkeysStore
const canConfigure = computed(() => providerState.canConfigure)
const isEditable = computed(() => checkIsEditable(providerState))
const isSystemManaged = computed(() => checkIsSystemManaged(providerState))
const isHoldSupported = computed(() => providerState.provider !== 'external')
const providerNote = computed(() => providerNoteKey(providerState))
const globalInfo = computed(() =>
  [t('settings.globalActionsHint'), providerNote.value && t(providerNote.value)]
    .filter(Boolean)
    .join('\n\n')
)

const modes = (Object.keys(DEFAULT_USER_CONFIG.hotkeys) as HotkeyId[])
  .filter(
    (id) =>
      id !== 'selectionCorrection' &&
      !CUSTOM_ACTION_HOTKEY_IDS.includes(
        id as (typeof CUSTOM_ACTION_HOTKEY_IDS)[number]
      )
  )
  .sort(
    (a, b) =>
      (MODE_ORDER.indexOf(a) + 1 || Infinity) -
      (MODE_ORDER.indexOf(b) + 1 || Infinity)
  )
const inlineId = INLINE_CORRECTION_HOTKEY_ID

const openCommandForMode = (mode: string) => {
  if (mode === 'selectionActions') return 'tyco-ctl open selection-actions'
  if (mode === 'chatPrompts') return 'tyco-ctl open chat-prompts'
  const page = /^selectionActionsPage(\d)$/.exec(mode)
  if (page) return `tyco-ctl open selection-actions:${page[1]}`
  return `tyco-ctl open ${mode}`
}

const customActionSlots = computed(() => {
  const current = userConfig.value.customActionSlots ?? []
  if (current.length === 5) return current
  const filled = [...current]
  while (filled.length < 5) {
    filled.push({ action: null, takesSelection: true })
  }
  return filled
})

const customSlotsConfigs = computed(() =>
  customActionSlots.value.map((s) => s.action)
)

const {
  actionOptions: baseCustomActionOptions,
  availableActions,
  optionId,
  commands,
  toolsStore,
} = useMainActionChoices(customSlotsConfigs)

const customActionOptions = computed(() => [
  { id: '', name: t('settings.customActionNotAssigned'), group: '' },
  ...baseCustomActionOptions.value,
])

const customActionRows = computed<HotkeyRow[]>(() =>
  CUSTOM_ACTION_HOTKEY_IDS.map((id, index) => ({
    id,
    label: t('settings.customActionSlot', { index: index + 1 }),
    value: displayedShortcut(
      providerState,
      id,
      userConfig.value.hotkeys[id] ?? ''
    ),
    defaultValue: '',
    command: activationCommand(
      providerState,
      id,
      `tyco-ctl open custom-action:${index + 1}`
    ),
    externalHint: t('settings.externalMethodsHint'),
  }))
)

function customActionHotkeyRow(index: number): HotkeyRow {
  return customActionRows.value[index]
}

function slotBehavior(index: number) {
  const slot = customActionSlots.value[index]
  return resolveActionSelectionBehavior(
    slot?.action,
    commands.value,
    toolsStore
  )
}

function slotTakesSelection(index: number): boolean {
  const behavior = slotBehavior(index)
  if (behavior.forcedValue !== null) {
    return behavior.forcedValue
  }
  return customActionSlots.value[index]?.takesSelection ?? true
}

function setSlotTakesSelection(index: number, value: boolean) {
  const slots = [...customActionSlots.value]
  const current = slots[index] ?? { action: null, takesSelection: true }
  slots[index] = { ...current, takesSelection: value }
  userConfig.value.customActionSlots = slots
}

function updateCustomAction(
  index: number,
  optionValue: string | number | undefined
) {
  const slots = [...customActionSlots.value]
  const current = slots[index] ?? { action: null, takesSelection: true }
  let newAction: MainActionConfig | null = null
  if (optionValue && optionValue !== '') {
    const selected = availableActions.value.find(
      ({ config }) => optionId(config) === optionValue
    )
    newAction = selected ? selected.config : null
  }
  const behavior = resolveActionSelectionBehavior(
    newAction,
    commands.value,
    toolsStore
  )
  const previousBehavior = resolveActionSelectionBehavior(
    current.action,
    commands.value,
    toolsStore
  )
  const takesSelection =
    behavior.forcedValue !== null
      ? behavior.forcedValue
      : previousBehavior.forcedValue !== null
        ? true
        : current.takesSelection
  slots[index] = { action: newAction, takesSelection }
  userConfig.value.customActionSlots = slots
}

const allRows = computed<HotkeyRow[]>(() => [
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
    command: activationCommand(providerState, mode, openCommandForMode(mode)),
    externalHint: t('settings.externalMethodsHint'),
  })),
  {
    id: inlineId,
    label: t('settings.hotkeyActions.selectionCorrection'),
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
    command: activationCommand(
      providerState,
      inlineId,
      'tyco-ctl replace correction'
    ),
    externalHint: t('settings.inlineCorrectionExternalHint'),
    description: t('settings.inlineCorrectionHint'),
  },
  ...customActionRows.value,
])

const rows = computed(() =>
  allRows.value.filter(
    (row) =>
      !CUSTOM_ACTION_HOTKEY_IDS.includes(row.id as HotkeyId) &&
      (PRIMARY_HOTKEY_IDS.includes(row.id as HotkeyId) ||
        Boolean(userConfig.value.hotkeys[row.id as HotkeyId]?.trim()) ||
        Boolean(displayedShortcut(providerState, row.id, '')))
  )
)

const generalRows = computed(() =>
  rows.value.filter((row) => !isVoiceHotkey(row.id))
)

const generalGroups = computed(() => {
  const rowMap = new Map(generalRows.value.map((row) => [row.id, row]))
  const placed = new Set<string>()

  const groups: { id: string; label: string; rows: HotkeyRow[] }[] = []

  for (const groupDef of GENERAL_HOTKEY_GROUPS) {
    const groupRows: HotkeyRow[] = []
    for (const id of groupDef.hotkeyIds) {
      const row = rowMap.get(id)
      if (row) {
        groupRows.push(row)
        placed.add(id)
      }
    }
    if (groupRows.length > 0) {
      groups.push({
        id: groupDef.id,
        label: t(groupDef.labelKey),
        rows: groupRows,
      })
    }
  }

  const remaining = generalRows.value.filter((row) => !placed.has(row.id))
  if (remaining.length > 0) {
    if (groups.length > 0) {
      groups[groups.length - 1].rows.push(...remaining)
    } else {
      groups.push({ id: 'other', label: '', rows: remaining })
    }
  }

  return groups
})
const voiceRows = computed(() =>
  VOICE_HOTKEY_IDS.flatMap(
    (id) => rows.value.find((row) => row.id === id) ?? []
  )
)

/**
 * The Push-to-Talk switch under a voice hotkey, by hotkey id. Voice questions
 * to the AI have none: their recording ends by a press only.
 */
const holdToggles = computed(
  (): Record<
    string,
    {
      setting: 'isVoiceInputHoldEnabled' | 'isVoiceCommandsHoldEnabled'
      label: string
      info: string
    }
  > => ({
    voice: {
      setting: 'isVoiceInputHoldEnabled',
      label: t('settings.voiceHold.voice'),
      info: t('settings.voiceHoldHint.voice'),
    },
    voiceCommands: {
      setting: 'isVoiceCommandsHoldEnabled',
      label: t('settings.voiceHold.voiceCommands'),
      info: t('settings.voiceHoldHint.voiceCommands'),
    },
  })
)

/** Rows whose new shortcut was refused here, with the reason */
const rowErrors = ref<Record<string, string>>({})

function rowError(id: string): string | undefined {
  if (rowErrors.value[id]) return rowErrors.value[id]
  return hasConflict(providerState, id)
    ? t('settings.hotkeyStatus.conflict')
    : undefined
}

function setShortcut(id: string, shortcut: string) {
  // every hotkey counts, those of hidden rows too
  const duplicate = duplicateHotkey(allRows.value, id, shortcut)
  if (duplicate) {
    const action = allRows.value.find((row) => row.id === duplicate)
    rowErrors.value = {
      ...rowErrors.value,
      [id]: t('settings.hotkeyStatus.duplicate', {
        action: action?.label ?? duplicate,
      }),
    }
    return
  }
  const { [id]: _cleared, ...rest } = rowErrors.value
  rowErrors.value = rest
  // Native registration and persistence are one backend transaction.
  operations.updateHotkey(id, shortcut)
}

// pressing a bound shortcut must reach the field, not run its action
function suspendHotkeys(suspended: boolean) {
  hotkeysStore.suspendHotkeys(suspended)
}

const missing = computed(() =>
  missingHotkeys(
    providerState,
    [...rows.value, ...customActionRows.value].map((row) => row.id)
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

.custom-action-slot {
  width: 100%;
}

.custom-action-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-md);
  width: 100%;
}

.custom-action-select {
  flex: 1 1 200px;
  min-width: 180px;
}

.custom-action-hotkey {
  flex: 1 1 180px;
  min-width: 160px;
}

.hotkey-group {
  display: flex;
  flex-direction: column;
}

.hotkey-group-header {
  display: flex;
  align-items: center;
  padding: var(--space-xs) var(--space-lg);
  background: var(--app-surface-raised);
  border-bottom: 1px solid var(--app-border-subtle);
}

.hotkey-group:not(:first-child) .hotkey-group-header {
  border-top: 1px solid var(--app-border-subtle);
}

.hotkey-group-title {
  font-size: var(--text-micro);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: var(--app-text-muted);
}

.voice-hotkey-item {
  display: flex;
  flex-direction: column;
}

.voice-hotkey-item + .voice-hotkey-item {
  border-top: 1px solid var(--app-border-subtle);
}

.voice-hold-row {
  background-color: var(--app-surface-sunken);
  border-left: 2px solid var(--app-border-strong);
  padding-top: var(--space-sm);
  padding-bottom: var(--space-sm);
}

.voice-hold-row :deep(.field-row-title) {
  font-size: var(--text-control);
  color: var(--app-text-muted);
}
</style>
