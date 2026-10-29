<template>
  <div class="settings-stack">
    <SettingsSection :description="t('settings.transformationsHint')">
      <SettingsTaskModel task="transformation" />
    </SettingsSection>
    <SettingsSection bare>
      <ShortcutSlots
        :items="transformationSlots"
        @move="moveTransformation"
        @add="addTransformation"
        @remove="removeTransformation"
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
  type TransformationLibrary,
  moveTransformationSlot,
  placeNewTransformation,
  removeTransformationAt,
  transformationSlotList,
  updateTransformation,
  withoutEmptyTransformations,
} from '../../lib/transformations/transformation-library'
import {
  type TransformationConfig,
  newTransformationId,
} from '../../lib/transformations/transformation-prompt'
import FieldInput from '../common/FieldInput.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'
import ShortcutSlots from './ShortcutSlots.vue'
import { SHORTCUT_SLOT_KEYS } from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()

const transformationSlots = computed(() =>
  transformationSlotList(userConfig.value.transformations)
)

function setLibrary(library: TransformationLibrary) {
  userConfig.value.transformations = library
}

function moveTransformation(from: number, to: number) {
  setLibrary(moveTransformationSlot(userConfig.value.transformations, from, to))
}

function addTransformation(index: number) {
  setLibrary(
    placeNewTransformation(userConfig.value.transformations, index, {
      id: newTransformationId(userConfig.value.transformations.items),
      name: '',
      rule: '',
    })
  )
}

function removeTransformation(index: number) {
  const transformationId =
    userConfig.value.transformations.slots[SHORTCUT_SLOT_KEYS[index]!]
  setLibrary(removeTransformationAt(userConfig.value.transformations, index))
  if (transformationId && userConfig.value.mainActions) {
    userConfig.value.mainActions = Object.fromEntries(
      Object.entries(userConfig.value.mainActions).filter(
        ([, action]) =>
          action?.type !== 'transformation' ||
          action.transformationId !== transformationId
      )
    )
  }
}

function updateItem(
  index: number,
  field: keyof TransformationConfig,
  value: unknown
) {
  const item = transformationSlots.value[index]
  if (typeof value !== 'string' || !item) return
  setLibrary(
    updateTransformation(userConfig.value.transformations, item.id, {
      [field]: value,
    })
  )
}

onUnmounted(() => {
  const cleaned = withoutEmptyTransformations(userConfig.value.transformations)
  if (cleaned.items.length !== userConfig.value.transformations.items.length)
    setLibrary(cleaned)
})
</script>
