<template>
  <SettingsSection>
    <FieldRow
      :label="t('settings.dialogEnabled')"
      :hint="t('settings.dialogEnabledHint')"
    >
      <FieldSwitch
        :model-value="dialog.isEnabled"
        @update:model-value="setDialog({ isEnabled: $event })"
      />
    </FieldRow>
  </SettingsSection>
  <SettingsSection v-if="dialog.isEnabled">
    <FieldRow
      :label="t('settings.dialogTranslationProvider')"
      :hint="t('settings.dialogTranslationProviderHint')"
    >
      <FieldSelect
        :model-value="dialog.translationProvider"
        :options="providerOptions"
        @update:model-value="
          (provider) =>
            setDialog({
              translationProvider:
                provider as DialogConfig['translationProvider'],
            })
        "
      />
    </FieldRow>
    <FieldRow
      :label="t('settings.dialogRecordings')"
      :hint="t('settings.dialogRecordingsHint')"
    >
      <Button size="sm" variant="ghost" @click="openFolder">{{
        t('settings.storageOpenFolder')
      }}</Button>
    </FieldRow>
    <FieldRow
      :label="t('settings.dialogRecordingMixedDown')"
      :hint="t('settings.dialogRecordingMixedDownHint')"
    >
      <FieldSwitch
        :model-value="dialog.isRecordingMixedDown"
        @update:model-value="setDialog({ isRecordingMixedDown: $event })"
      />
    </FieldRow>
    <FieldRow
      :label="t('settings.dialogRecordingProcessed')"
      :hint="t('settings.dialogRecordingProcessedHint')"
    >
      <FieldSwitch
        :model-value="dialog.isRecordingProcessed"
        @update:model-value="setDialog({ isRecordingProcessed: $event })"
      />
    </FieldRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { useIpcStore } from '../../stores/ipc'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SettingsSection from './SettingsSection.vue'
import { DEFAULT_USER_CONFIG, type DialogConfig } from '@tyco/shared'

// the source, the language and the view are remembered from the dialog's
// toolbar; only what the toolbar does not offer is set here. The notice about
// recordings is acknowledged once, in the dialog, and has no setting
const { t } = useI18n()
const { draft } = useSettingsContext()
const dialog = computed<DialogConfig>(
  () => draft.value.dialog ?? DEFAULT_USER_CONFIG.dialog
)
const setDialog = (patch: Partial<DialogConfig>) => {
  draft.value.dialog = { ...dialog.value, ...patch }
}

const providerOptions = computed<
  { id: DialogConfig['translationProvider']; name: string }[]
>(() => [
  { id: 'default', name: t('settings.dialogProviderDefault') },
  { id: 'llm', name: t('settings.dialogProviderLlm') },
  { id: 'deepl', name: 'DeepL' },
  { id: 'google', name: 'Google' },
])

const ipc = useIpcStore()
// the recordings of the history, the folder created when it is not there yet
async function openFolder() {
  await ipc.callOrNotify('open_recordings_folder')
}
</script>
