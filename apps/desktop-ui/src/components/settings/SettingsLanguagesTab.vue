<template>
  <div class="settings-stack">
    <SettingsSection bare>
      <template #description>
        <span>{{ t('settings.translationsHint') }}</span
        >{{ ' ' }} <span>{{ t('settings.translationsMethodHint') }}</span
        >{{ ' ' }}
        <InlineAction @click="navigate('translations')">
          {{ t('settings.translationsTab') }}</InlineAction
        >.
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
            :model-value="item"
            :options="translateLanguageOptions"
            @update:model-value="updateLanguage(index, $event)"
          />
        </template>
      </ShortcutSlots>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import {
  DEFAULT_LANGUAGE,
  buildLanguageOptions,
} from '../../lib/locale/language'
import {
  moveShortcutSlot,
  normalizeShortcutSlots,
} from '../../lib/shortcut-slots/shortcut-slots'
import FieldSelect from '../common/FieldSelect.vue'
import InlineAction from '../common/InlineAction.vue'
import SettingsSection from './SettingsSection.vue'
import ShortcutSlots from './ShortcutSlots.vue'

const { t } = useI18n()
const { draft: userConfig, navigate } = useSettingsContext()

const translateLanguageOptions = computed(() => {
  return buildLanguageOptions(
    (userConfig.value.translation.targetLanguages || []).filter(Boolean),
    false,
    t
  ).map((option) => ({
    id: option.id,
    name: option.id ? `${option.name} (${option.id})` : option.name,
  }))
})

const translateLanguageSlots = computed(() =>
  normalizeShortcutSlots<string>(userConfig.value.translation.targetLanguages)
)

function setSlots(slots: (string | null)[]) {
  userConfig.value.translation.targetLanguages = slots as string[]
}

function moveLanguage(from: number, to: number) {
  setSlots(moveShortcutSlot(translateLanguageSlots.value, from, to))
}

function addLanguage(index: number) {
  const slots = [...translateLanguageSlots.value]
  slots[index] = DEFAULT_LANGUAGE
  setSlots(slots)
}

function removeLanguage(index: number) {
  const slots = [...translateLanguageSlots.value]
  slots[index] = null
  setSlots(slots)
}

function updateLanguage(index: number, value: string | number | undefined) {
  if (typeof value !== 'string') return
  const slots = [...translateLanguageSlots.value]
  slots[index] = value
  setSlots(slots)
}
</script>

<style scoped></style>
