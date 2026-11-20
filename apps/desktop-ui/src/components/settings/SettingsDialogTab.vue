<template>
  <SettingsSection>
    <FieldRow
      :label="t('dialog.source')"
      :hint="t('settings.dialogSourceHint')"
    >
      <FieldSelect
        :model-value="dialog.source"
        :options="sourceOptions"
        @update:model-value="
          (source) => setDialog({ source: source as DialogSource })
        "
      />
    </FieldRow>
    <FieldRow
      :label="t('dialog.translationLanguage')"
      :hint="t('settings.dialogTranslationHint')"
    >
      <FieldSelect
        :model-value="dialog.translationTargetLanguage"
        :options="languageOptions"
        @update:model-value="
          (language) =>
            setDialog({ translationTargetLanguage: String(language ?? '') })
        "
      />
    </FieldRow>
    <FieldRow :label="t('dialog.textDisplay')">
      <FieldSelect
        :model-value="dialog.textDisplay"
        :options="displayOptions"
        @update:model-value="
          (textDisplay) =>
            setDialog({ textDisplay: textDisplay as DialogTextDisplay })
        "
      />
    </FieldRow>
    <FieldRow :label="t('settings.dialogTranslationProvider')">
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
import { dialogLanguageOptions } from '../../lib/dialog/dialog-languages'
import { translationLanguageLabel } from '../../lib/translation/translation-languages'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import SettingsSection from './SettingsSection.vue'
import {
  DEFAULT_USER_CONFIG,
  type DialogConfig,
  type DialogSource,
  type DialogTextDisplay,
} from '@tyco/shared'

const { t, locale } = useI18n()
const { draft } = useSettingsContext()
const dialog = computed<DialogConfig>(
  () => draft.value.dialog ?? DEFAULT_USER_CONFIG.dialog
)
const setDialog = (patch: Partial<DialogConfig>) => {
  draft.value.dialog = { ...dialog.value, ...patch }
}

const sourceOptions = computed<{ id: DialogSource; name: string }[]>(() => [
  { id: 'microphoneAndSystem', name: t('dialog.sourceMicrophoneAndSystem') },
  { id: 'system', name: t('dialog.sourceSystem') },
])
const displayOptions = computed<{ id: DialogTextDisplay; name: string }[]>(
  () => [
    { id: 'translation', name: t('dialog.displayTranslation') },
    { id: 'original', name: t('dialog.displayOriginal') },
    { id: 'both', name: t('dialog.displayBoth') },
  ]
)
const providerOptions = computed<
  { id: DialogConfig['translationProvider']; name: string }[]
>(() => [
  { id: 'default', name: t('settings.dialogProviderDefault') },
  { id: 'llm', name: t('settings.dialogProviderLlm') },
  { id: 'deepl', name: 'DeepL' },
  { id: 'google', name: 'Google' },
])
const languageOptions = computed(() =>
  dialogLanguageOptions({
    targetLanguages: draft.value.translation?.targetLanguages,
    current: dialog.value.translationTargetLanguage,
    offLabel: t('dialog.noTranslation'),
    labelOf: (id) => translationLanguageLabel(id, String(locale.value)),
  })
)
</script>
