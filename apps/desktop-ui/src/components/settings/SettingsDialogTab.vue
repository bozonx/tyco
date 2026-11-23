<template>
  <div class="settings-stack">
    <SettingsSection>
      <FieldRow
        :label="t('settings.dialogEnabled')"
        :info="t('settings.dialogEnabledInfo')"
      >
        <FieldSwitch
          :model-value="dialog.isEnabled"
          @update:model-value="setDialog({ isEnabled: $event })"
        />
      </FieldRow>
    </SettingsSection>

    <template v-if="dialog.isEnabled">
      <SettingsSection :title="t('settings.dialogTranslationSection')">
        <SettingsTaskModel
          task="dialogTranslation"
          :info="t('settings.dialogTranslationModelInfo')"
        />
        <FieldRow
          :label="t('settings.dialogTranslationGlossary')"
          :info="t('settings.dialogTranslationGlossaryInfo')"
        >
          <div class="dialog-translation-glossary">
            <span class="text-sm text-muted">
              {{ t('settings.dialogTranslationGlossaryShared') }}
            </span>
            <InlineAction @click="navigate('translations#translation-glossary')">
              {{ t('settings.dialogTranslationGlossaryOpen') }}
            </InlineAction>
          </div>
        </FieldRow>
        <FieldRow
          :label="t('settings.dialogTranslationRules')"
          :info="t('settings.dialogTranslationRulesInfo')"
          vertical
        >
          <FieldPromptTextArea
            v-model="draft.llm.tasks.dialogTranslation.rule"
            :modal-title="t('settings.dialogTranslationRules')"
          />
        </FieldRow>
      </SettingsSection>

      <SettingsSection :title="t('settings.dialogRecordingSection')">
        <FieldRow
          :label="t('settings.dialogRecordingMixedDown')"
          :info="t('settings.dialogRecordingMixedDownInfo')"
        >
          <FieldSwitch
            :model-value="dialog.isRecordingMixedDown"
            @update:model-value="setDialog({ isRecordingMixedDown: $event })"
          />
        </FieldRow>
        <FieldRow
          :label="t('settings.dialogRecordingProcessed')"
          :info="t('settings.dialogRecordingProcessedInfo')"
        >
          <FieldSwitch
            :model-value="dialog.isRecordingProcessed"
            @update:model-value="setDialog({ isRecordingProcessed: $event })"
          />
        </FieldRow>
      </SettingsSection>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import FieldPromptTextArea from '../common/FieldPromptTextArea.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import InlineAction from '../common/InlineAction.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'
import { DEFAULT_USER_CONFIG, type DialogConfig } from '@tyco/shared'

// the source, the language and the view are remembered from the dialog's
// toolbar; only what the toolbar does not offer is set here, with the model
// that translates (only a model reads the lines before as context). The notice about
// recordings is acknowledged once, in the dialog, and has no setting
const { t } = useI18n()
const { draft, navigate } = useSettingsContext()
const dialog = computed<DialogConfig>(
  () => draft.value.dialog ?? DEFAULT_USER_CONFIG.dialog
)
const setDialog = (patch: Partial<DialogConfig>) => {
  draft.value.dialog = { ...dialog.value, ...patch }
}
</script>

<style scoped>
.dialog-translation-glossary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs) var(--space-sm);
  min-width: 0;
}
</style>
