<template>
  <SettingsSection :description="t('settings.translationsHint')" bare>
    <ShortcutSlots
      :items="translateLanguageSlots"
      @move="moveLanguage"
      @add="addLanguage"
      @remove="removeLanguage"
    >
      <template #item="{ item, index }">
        <FieldSelect
          class="w-full"
          :value="item"
          :options="translateLanguageOptions"
          @update:value="updateLanguage(index, $event)"
        />
      </template>
    </ShortcutSlots>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import {
  DEFAULT_LANGUAGE,
  buildLanguageOptions,
} from '../../lib/locale/language'
import {
  moveShortcutSlot,
  normalizeShortcutSlots,
} from '../../lib/shortcut-slots/shortcut-slots'
import FieldSelect from '../common/FieldSelect.vue'
import ShortcutSlots from '../common/ShortcutSlots.vue'

const props = defineProps<{ userConfig: Record<string, any> }>()

const emit = defineEmits<{
  (e: 'update:toTranslateLanguages', value: string[]): void
}>()

const { t, locale } = useI18n()

const translateLanguageOptions = computed(() => {
  // eslint-disable-next-line @typescript-eslint/no-unused-expressions
  locale.value
  return buildLanguageOptions(
    (props.userConfig.toTranslateLanguages || []).filter(Boolean),
    false,
    t
  )
})

const translateLanguageSlots = computed(() =>
  normalizeShortcutSlots<string>(props.userConfig.toTranslateLanguages)
)

function emitSlots(slots: (string | null)[]) {
  emit('update:toTranslateLanguages', slots as string[])
}

function moveLanguage(from: number, to: number) {
  emitSlots(moveShortcutSlot(translateLanguageSlots.value, from, to))
}

function addLanguage(index: number) {
  const slots = [...translateLanguageSlots.value]
  slots[index] = DEFAULT_LANGUAGE
  emitSlots(slots)
}

function removeLanguage(index: number) {
  const slots = [...translateLanguageSlots.value]
  slots[index] = null
  emitSlots(slots)
}

function updateLanguage(index: number, value: string | number | undefined) {
  if (typeof value !== 'string') return
  const slots = [...translateLanguageSlots.value]
  slots[index] = value
  emitSlots(slots)
}
</script>
