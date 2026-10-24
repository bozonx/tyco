<template>
  <div class="settings-stack">
    <SettingsSection :title="t('settings.globalHotkeysTitle')">
      <template #description>
        <span>{{ t('settings.correctionHotkeysHint') }}</span
        >{{ ' ' }}
        <InlineAction @click="navigate('global-actions')">
          {{ t('settings.hotkeysTab') }}</InlineAction
        >.
      </template>

      <FieldRow
        :label="t('settings.hotkeyActions.correction')"
        :hint="t('settings.correctionPreviewHint')"
      >
        <div class="hotkey-control">
          <HotkeyInput
            :model-value="previewHotkey.value"
            :aria-label="t('settings.hotkeyActions.correction')"
            :placeholder="t('settings.hotkeyNotAssigned')"
            :readonly="!isEditable"
            :platform="providerState.platform"
            @update:model-value="setShortcut('correction', $event)"
            @recording="suspendHotkeys"
          />
          <IconButton
            v-if="isEditable && previewHotkey.value"
            size="sm"
            variant="ghost"
            icon="mdi:close"
            :label="t('settings.unassignHotkey')"
            @click="setShortcut('correction', '')"
          />
          <IconButton
            v-if="
              isEditable &&
              previewHotkey.defaultValue &&
              previewHotkey.value !== previewHotkey.defaultValue
            "
            size="sm"
            variant="ghost"
            icon="mdi:restore"
            :label="t('settings.resetToDefault')"
            @click="setShortcut('correction', previewHotkey.defaultValue)"
          />
        </div>
      </FieldRow>

      <FieldRow
        :label="t('settings.hotkeyActions.selectionCorrection')"
        :hint="t('settings.inlineCorrectionHint')"
      >
        <div class="hotkey-control">
          <HotkeyInput
            :model-value="inlineHotkey.value"
            :aria-label="t('settings.hotkeyActions.selectionCorrection')"
            :placeholder="t('settings.hotkeyNotAssigned')"
            :readonly="!isEditable"
            :platform="providerState.platform"
            @update:model-value="setShortcut(inlineId, $event)"
            @recording="suspendHotkeys"
          />
          <IconButton
            v-if="isEditable && inlineHotkey.value"
            size="sm"
            variant="ghost"
            icon="mdi:close"
            :label="t('settings.unassignHotkey')"
            @click="setShortcut(inlineId, '')"
          />
          <IconButton
            v-if="
              isEditable &&
              inlineHotkey.defaultValue &&
              inlineHotkey.value !== inlineHotkey.defaultValue
            "
            size="sm"
            variant="ghost"
            icon="mdi:restore"
            :label="t('settings.resetToDefault')"
            @click="setShortcut(inlineId, inlineHotkey.defaultValue)"
          />
        </div>
      </FieldRow>
    </SettingsSection>

    <SettingsSection
      :title="t('settings.aiCategory')"
      :description="t('settings.correctionPageHint')"
    >
      <SettingsTaskModel task="correction" />
      <FieldRow
        :label="t('settings.correctionPrompt')"
        :info="t('settings.correctionPromptInfo')"
        vertical
      >
        <FieldTextArea
          v-model="userConfig.llm.tasks.correction.rule"
          :placeholder="t('settings.correctionPromptPlaceholder')"
        />
      </FieldRow>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import {
  isEditable as checkIsEditable,
  defaultShortcut,
  displayedShortcut,
} from '../../lib/hotkeys/hotkey-settings'
import { useGlobalHotkeysStore } from '../../stores/global-hotkeys'
import FieldRow from '../common/FieldRow.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import IconButton from '../common/IconButton.vue'
import InlineAction from '../common/InlineAction.vue'
import HotkeyInput from './HotkeyInput.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'
import { DEFAULT_USER_CONFIG, INLINE_CORRECTION_HOTKEY_ID } from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig, navigate, operations } = useSettingsContext()

const hotkeysStore = useGlobalHotkeysStore()
const { providerState } = hotkeysStore
const isEditable = computed(() => checkIsEditable(providerState))

const inlineId = INLINE_CORRECTION_HOTKEY_ID

const previewHotkey = computed(() => ({
  value: displayedShortcut(
    providerState,
    'correction',
    userConfig.value.hotkeys.correction ?? ''
  ),
  defaultValue: defaultShortcut(
    providerState,
    'correction',
    DEFAULT_USER_CONFIG.hotkeys.correction
  ),
}))

const inlineHotkey = computed(() => ({
  value: displayedShortcut(
    providerState,
    inlineId,
    userConfig.value.hotkeys.selectionCorrection ?? ''
  ),
  defaultValue: defaultShortcut(
    providerState,
    inlineId,
    DEFAULT_USER_CONFIG.hotkeys.selectionCorrection
  ),
}))

function setShortcut(id: string, shortcut: string) {
  operations.updateHotkey(id, shortcut)
}

function suspendHotkeys(suspended: boolean) {
  hotkeysStore.suspendHotkeys(suspended)
}
</script>

<style scoped>
.hotkey-control {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
}
</style>
