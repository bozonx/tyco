<template>
  <div class="flex flex-col gap-6">
    <SettingsSection :description="t('settings.translationsHint')" bare>
      <template #actions>
        <Button
          sm
          ghost
          icon="mdi:translate"
          @click="emit('navigate', 'translations')"
        >
          {{ t('settings.translationEngineLink') }}
        </Button>
      </template>
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
  </div>
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
import Button from '../common/Button.vue'
import FieldSelect from '../common/FieldSelect.vue'
import SettingsSection from '../common/SettingsSection.vue'
import ShortcutSlots from '../common/ShortcutSlots.vue'

const props = defineProps<{ userConfig: Record<string, any> }>()

const emit = defineEmits<{
  (e: 'update:toTranslateLanguages', value: string[]): void
  (e: 'navigate', tab: string): void
}>()

const { t } = useI18n()

const translateLanguageOptions = computed(() => {
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
