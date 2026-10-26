<template>
  <div class="flex flex-col gap-2 w-full">
    <SearchInput
      v-model="query"
      :placeholder="t('menu.translateTargetPlaceholder')"
    />
    <FieldSelect
      :model-value="selectedLanguage"
      :options="visibleOptions"
      @update:model-value="pickLanguage"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { filterOptions } from '../../lib/menu-query/menu-query'
import {
  type TranslationProvider,
  resolveTranslationLanguage,
  translationLanguageLabel,
  translationLanguageOptions,
  translationLanguageSearchNames,
} from '../../lib/translation/translation-languages'
import FieldSelect from '../common/FieldSelect.vue'
import SearchInput from '../common/SearchInput.vue'

interface LanguageOption {
  id: string
  name: string
  label: string
  keywords: string[]
  disabled?: boolean
}

const props = defineProps<{
  modelValue?: string | null
  provider: TranslationProvider
  preferredLanguages?: string[]
  placeholder?: string
}>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
const { t, locale } = useI18n()
const query = ref('')
const selectedLanguage = computed(() =>
  props.modelValue
    ? (resolveTranslationLanguage(props.modelValue, props.provider, 'target') ??
      props.modelValue)
    : ''
)
const options = computed<LanguageOption[]>(() => {
  const preferred = new Set(
    (props.preferredLanguages ?? []).flatMap(
      (id) => resolveTranslationLanguage(id, props.provider, 'target') ?? []
    )
  )
  return translationLanguageOptions(props.provider, locale.value)
    .map(({ id, name }) => ({
      id,
      name: `${name} (${id})`,
      label: name,
      keywords: translationLanguageSearchNames(id),
    }))
    .sort((a, b) => Number(preferred.has(b.id)) - Number(preferred.has(a.id)))
})
const visibleOptions = computed(() => {
  const filtered = filterOptions(options.value, query.value).slice(0, 100)
  if (query.value.trim()) return filtered
  const selected = options.value.find(({ id }) => id === selectedLanguage.value)
  if (selected && !filtered.includes(selected)) filtered.unshift(selected)
  if (selectedLanguage.value && !selected)
    filtered.unshift({
      id: selectedLanguage.value,
      name: `${translationLanguageLabel(selectedLanguage.value, locale.value)} (${t('settings.translationLanguageUnavailable')})`,
      label: '',
      keywords: [],
      disabled: true,
    })
  return props.placeholder
    ? [{ id: '', name: props.placeholder }, ...filtered]
    : filtered
})
function pickLanguage(value: string | number | undefined) {
  if (typeof value !== 'string') return
  emit('update:modelValue', value)
  query.value = ''
}
watch(
  () => props.provider,
  () => {
    query.value = ''
  }
)
</script>
