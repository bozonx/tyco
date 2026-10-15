<template>
  <FieldRow
    vertical
    density="compact"
    :label="t('commands.languageLabel')"
    :info="t('commands.languageInfo')"
    :warning="warnings"
  >
    <FieldSelect
      :model-value="language"
      :options="languageOptions"
      @update:model-value="emit('update', 'language', $event ?? '')"
    />
  </FieldRow>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { buildLanguageOptions } from '../../lib/locale/language'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import type { CommandConfig, UserConfig } from '@tyco/shared'

const props = defineProps<{
  command: CommandConfig
  userConfig?: UserConfig
  warnings: string[]
}>()
const emit = defineEmits<{ update: [field: string, value: unknown] }>()
const { t } = useI18n()
const language = computed(() =>
  typeof props.command.toolConfig.language === 'string'
    ? props.command.toolConfig.language
    : ''
)
const languageOptions = computed(() => {
  const slots = (props.userConfig?.translation.targetLanguages ?? []).filter(
    (language): language is string => Boolean(language)
  )
  const options = buildLanguageOptions([...slots, language.value], false, t)
  // the languages of the translation slots come first
  const slotOptions = slots.flatMap(
    (language) => options.find((option) => option.id === language) ?? []
  )
  return [
    { id: '', name: t('commands.languagePlaceholder') },
    ...slotOptions,
    ...options.filter((option) => !slots.includes(option.id)),
  ]
})
</script>
