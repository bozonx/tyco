<template>
  <div class="fields-col">
    <FieldRow :label="t('settings.translateLanguages')">
      <FieldItems
        :items="translateLanguagesItems"
        @update:items="updateTranslateLanguages"
      >
        <template #item="{ item, index }">
          <div class="flex flex-row gap-2 w-full">
            <KeyButton>{{ PRESETS_KEYS[index] }}</KeyButton>
            <FieldSelect
              class="flex-1"
              v-model:value="item.value"
              :options="translateLanguageOptions"
            />
          </div>
        </template>
      </FieldItems>
    </FieldRow>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { buildLanguageOptions } from '../../lib/locale/language'
import { PRESETS_KEYS } from '../../types'
import FieldItems from '../common/FieldItems.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import KeyButton from '../common/KeyButton.vue'

const props = defineProps<{ userConfig: Record<string, any> }>()

const emit = defineEmits<{
  (e: 'update:toTranslateLanguages', value: string[]): void
}>()

const { t, locale } = useI18n()

const translateLanguageOptions = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  locale.value
  return buildLanguageOptions(
    props.userConfig.toTranslateLanguages || [],
    false,
    t
  )
})

const translateLanguagesItems = computed(() => {
  return (props.userConfig.toTranslateLanguages || []).map((lang: string) => ({
    value: lang,
  }))
})

const updateTranslateLanguages = (items: Record<string, any>[]) => {
  emit(
    'update:toTranslateLanguages',
    items.map((item: Record<string, any>) => item.value)
  )
}
</script>
