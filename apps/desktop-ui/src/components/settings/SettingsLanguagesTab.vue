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
          <TranslationLanguageSelect
            :model-value="item"
            :provider="userConfig.translation.provider"
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
  moveShortcutSlot,
  slotList,
  slotsFromList,
} from '../../lib/shortcut-slots/shortcut-slots'
import {
  resolveTranslationLanguage,
  translationLanguageOptions,
} from '../../lib/translation/translation-languages'
import InlineAction from '../common/InlineAction.vue'
import SettingsSection from './SettingsSection.vue'
import ShortcutSlots from './ShortcutSlots.vue'
import TranslationLanguageSelect from './TranslationLanguageSelect.vue'

const { t, locale } = useI18n()
const { draft: userConfig, navigate } = useSettingsContext()

const translateLanguageOptions = computed(() => {
  return translationLanguageOptions(
    userConfig.value.translation.provider,
    locale.value
  ).map((option) => ({ id: option.id, name: `${option.name} (${option.id})` }))
})

const translateLanguageSlots = computed(() =>
  slotList(userConfig.value.translation.targetLanguages)
)

function setSlots(slots: (string | null)[]) {
  userConfig.value.translation.targetLanguages = slotsFromList(slots)
}

function moveLanguage(from: number, to: number) {
  setSlots(moveShortcutSlot(translateLanguageSlots.value, from, to))
}

/** A language is in one slot only: a new slot takes the first one not used yet */
function addLanguage(index: number) {
  const slots = [...translateLanguageSlots.value]
  const used = new Set(
    slots.flatMap((id) =>
      id
        ? (resolveTranslationLanguage(
            id,
            userConfig.value.translation.provider,
            'target'
          ) ?? id)
        : []
    )
  )
  const language = [
    'en',
    ...translateLanguageOptions.value.map((option) => String(option.id)),
  ].find((id) => id && !used.has(id))
  if (!language) return
  slots[index] = language
  setSlots(slots)
}

function removeLanguage(index: number) {
  const slots = [...translateLanguageSlots.value]
  slots[index] = null
  setSlots(slots)
}

function updateLanguage(index: number, value: string | number | undefined) {
  if (typeof value !== 'string') return
  // a language chosen again leaves the slot it was in
  const slots = translateLanguageSlots.value.map((language) =>
    language &&
    resolveTranslationLanguage(
      language,
      userConfig.value.translation.provider,
      'target'
    ) === value
      ? null
      : language
  )
  slots[index] = value
  setSlots(slots)
}
</script>

<style scoped></style>
