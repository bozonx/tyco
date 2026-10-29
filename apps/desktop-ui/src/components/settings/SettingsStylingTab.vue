<template>
  <div class="settings-stack">
    <SettingsSection :description="t('settings.stylingHint')">
      <SettingsTaskModel task="styling" />
    </SettingsSection>
    <SettingsSection bare>
      <ShortcutSlots
        :items="stylingSlots"
        @move="moveStyling"
        @add="addStyling"
        @remove="removeStyling"
      >
        <template #item="{ item, index }">
          <div class="flex flex-col gap-2 w-full">
            <FieldInput
              :model-value="item.name"
              :placeholder="t('settings.name')"
              class="font-medium"
              @update:model-value="updateItem(index, 'name', $event)"
            />
            <FieldTextArea
              :model-value="item.rule"
              :placeholder="t('settings.rule')"
              @update:model-value="updateItem(index, 'rule', $event)"
            />
          </div>
        </template>
      </ShortcutSlots>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import {
  type StylingLibrary,
  moveStylingSlot,
  placeNewStyling,
  removeStylingAt,
  stylingSlotList,
  updateStyling,
  withoutEmptyStylings,
} from '../../lib/styling/styling-library'
import {
  type StylingConfig,
  newStylingId,
} from '../../lib/styling/styling-prompt'
import FieldInput from '../common/FieldInput.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'
import ShortcutSlots from './ShortcutSlots.vue'

const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()

const stylingSlots = computed(() => stylingSlotList(userConfig.value.styling))

function setLibrary(library: StylingLibrary) {
  userConfig.value.styling = library
}

function moveStyling(from: number, to: number) {
  setLibrary(moveStylingSlot(userConfig.value.styling, from, to))
}

function addStyling(index: number) {
  setLibrary(
    placeNewStyling(userConfig.value.styling, index, {
      id: newStylingId(userConfig.value.styling.items),
      name: '',
      rule: '',
    })
  )
}

function removeStyling(index: number) {
  setLibrary(removeStylingAt(userConfig.value.styling, index))
}

function updateItem(index: number, field: keyof StylingConfig, value: unknown) {
  const item = stylingSlots.value[index]
  if (typeof value !== 'string' || !item) return
  setLibrary(
    updateStyling(userConfig.value.styling, item.id, { [field]: value })
  )
}

onUnmounted(() => {
  const cleaned = withoutEmptyStylings(userConfig.value.styling)
  if (cleaned.items.length !== userConfig.value.styling.items.length)
    setLibrary(cleaned)
})
</script>
