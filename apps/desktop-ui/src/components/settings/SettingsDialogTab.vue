<template>
  <SettingsSection>
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
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import SettingsSection from './SettingsSection.vue'
import { DEFAULT_USER_CONFIG, type DialogConfig } from '@tyco/shared'

// the source, the language and the view are remembered from the dialog's
// toolbar; only what the toolbar does not offer is set here
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
</script>
