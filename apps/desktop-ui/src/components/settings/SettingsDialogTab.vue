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
      :label="t('settings.dialogRecordingsFolder')"
      :hint="t('settings.dialogRecordingsFolderHint')"
      vertical
      device-scoped
    >
      <div class="dialog-recordings-folder">
        <FieldInput
          class="dialog-recordings-folder-path"
          :model-value="dialog.recordingsFolder ?? ''"
          :placeholder="defaultFolder"
          @update:model-value="
            (folder) => setDialog({ recordingsFolder: String(folder ?? '') })
          "
        />
        <DirectoryPickerButton
          @select="(folder) => setDialog({ recordingsFolder: folder })"
        />
        <Button
          size="sm"
          variant="ghost"
          :disabled="!dialog.recordingsFolder"
          @click="setDialog({ recordingsFolder: '' })"
          >{{ t('settings.dialogRecordingsFolderReset') }}</Button
        >
        <Button size="sm" variant="ghost" @click="openFolder">{{
          t('settings.storageOpenFolder')
        }}</Button>
      </div>
    </FieldRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { useIpcStore } from '../../stores/ipc'
import Button from '../common/Button.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import DirectoryPickerButton from './DirectoryPickerButton.vue'
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
/** Where recordings go while the setting is empty */
const defaultFolder = ref('')
onMounted(async () => {
  const result = await ipc.call('get_default_recordings_folder')
  if (result.success && result.result) defaultFolder.value = result.result
})

// the folder in the field, created when it is not there yet
async function openFolder() {
  const folder = dialog.value.recordingsFolder?.trim()
  await ipc.callOrNotify('open_recordings_folder', { folder: folder || null })
}
</script>

<style scoped>
.dialog-recordings-folder {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}

.dialog-recordings-folder-path {
  flex: 1 1 16rem;
  min-width: 0;
}
</style>
