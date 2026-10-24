<template>
  <FieldRow
    vertical
    density="compact"
    :label="t('commands.languageLabel')"
    :info="t('commands.languageInfo')"
    :warning="warnings"
  >
    <TranslationLanguageSelect
      :model-value="language"
      :provider="userConfig?.translation.provider ?? 'llm'"
      :preferred-languages="preferredLanguages"
      :placeholder="t('commands.languagePlaceholder')"
      @update:model-value="emit('update', 'language', $event)"
    />
  </FieldRow>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { toolConfigText } from '../../lib/commands/command-config'
import FieldRow from '../common/FieldRow.vue'
import TranslationLanguageSelect from './TranslationLanguageSelect.vue'
import type { CommandConfig, UserConfig } from '@tyco/shared'

const props = defineProps<{
  command: CommandConfig
  userConfig?: UserConfig
  warnings: string[]
}>()
const emit = defineEmits<{ update: [field: string, value: unknown] }>()
const { t } = useI18n()
const language = computed(() => toolConfigText(props.command, 'language'))
const preferredLanguages = computed(() =>
  Object.values(props.userConfig?.translation.targetLanguages ?? {})
)
</script>
