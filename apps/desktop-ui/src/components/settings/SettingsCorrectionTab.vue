<template>
  <div class="settings-stack">
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

    <SettingsSection :title="t('settings.globalHotkeysTitle')">
      <template #description>
        <span>{{ t('settings.correctionHotkeysHint') }}</span
        >{{ ' ' }}
        <InlineAction @click="navigate('global-actions')">
          {{ t('settings.hotkeysTab') }}</InlineAction
        >.
      </template>

      <FieldRow
        v-for="hotkey in hotkeys"
        :key="hotkey.id"
        :label="hotkey.label"
        :hint="hotkey.hint"
        density="compact"
      >
        <HotkeyDisplay
          :shortcut="hotkey.shortcut"
          :placeholder="t('settings.hotkeyNotAssigned')"
          :platform="providerState.platform"
        />
      </FieldRow>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { displayedShortcut } from '../../lib/hotkeys/hotkey-settings'
import { useGlobalHotkeysStore } from '../../stores/global-hotkeys'
import FieldRow from '../common/FieldRow.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import InlineAction from '../common/InlineAction.vue'
import HotkeyDisplay from './HotkeyDisplay.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'
import { INLINE_CORRECTION_HOTKEY_ID } from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig, navigate } = useSettingsContext()
const { providerState } = useGlobalHotkeysStore()

const hotkeys = computed(() => [
  {
    id: 'correction',
    label: t('settings.hotkeyActions.correction'),
    hint: t('settings.correctionPreviewHint'),
    shortcut: displayedShortcut(
      providerState,
      'correction',
      userConfig.value.hotkeys.correction ?? ''
    ),
  },
  {
    id: INLINE_CORRECTION_HOTKEY_ID,
    label: t('settings.hotkeyActions.selectionCorrection'),
    hint: t('settings.inlineCorrectionHint'),
    shortcut: displayedShortcut(
      providerState,
      INLINE_CORRECTION_HOTKEY_ID,
      userConfig.value.hotkeys.selectionCorrection ?? ''
    ),
  },
])
</script>
