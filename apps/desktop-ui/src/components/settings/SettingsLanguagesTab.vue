<template>
  <div class="flex flex-col gap-6">
    <SettingsSection bare>
      <template #description>
        <span>{{ t('settings.translationsHint') }} </span>
        <span>{{ t('settings.translationsMethodHint') }} </span>
        <button
          type="button"
          class="settings-inline-link"
          @click="emit('navigate', 'translations')"
        >
          {{ t('settings.translationsTab') }}</button
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
  ).map((option) => ({
    id: option.id,
    name: option.id ? `${option.name} (${option.id})` : option.name,
  }))
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

<style scoped>
.settings-inline-link {
  display: inline;
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
  background: none;
  border: none;
  padding: 0;
  font: inherit;
  font-weight: 500;
}

.settings-inline-link:hover {
  filter: brightness(1.15);
}
</style>
