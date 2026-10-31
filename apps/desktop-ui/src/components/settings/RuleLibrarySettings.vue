<template>
  <div class="settings-stack">
    <SettingsSection :description="t(props.hintKey)">
      <SettingsTaskModel :task="props.task" />
    </SettingsSection>
    <SettingsSection bare>
      <ShortcutSlots
        :items="slots"
        @move="moveItem"
        @add="addItem"
        @remove="removeItem"
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
  type SlotLibrary,
  type SlotLibraryItem,
  moveSlotItem,
  placeNewSlotItem,
  removeSlotItemAt,
  slotItemList,
  updateSlotItem,
  withoutEmptySlotItems,
} from '../../lib/shortcut-slots/slot-library'
import { nextNumberedId } from '../../lib/shortcut-slots/slot-prompt'
import FieldInput from '../common/FieldInput.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'
import ShortcutSlots from './ShortcutSlots.vue'
import {
  type LlmTask,
  type MainActionConfig,
  SHORTCUT_SLOT_KEYS,
} from '@tyco/shared'

type Library = SlotLibrary<SlotLibraryItem>
type MainAction = MainActionConfig

/** The settings of a rule library: the styles or the transformations */
const props = defineProps<{
  task: LlmTask
  hintKey: string
  /** The config key of the library */
  libraryKey: 'styling' | 'transformations'
  /** The start of a new item id */
  idPrefix: string
  /** Whether a main action runs the item `id` */
  isMainActionOf: (action: MainAction, id: string) => boolean
}>()

const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()

const library = (): Library => userConfig.value[props.libraryKey]
const slots = computed(() => slotItemList(library()))

function setLibrary(next: Library) {
  userConfig.value[props.libraryKey] = next
}

/** Main actions of removed items would point nowhere */
function dropMainActions(removedIds: readonly string[]) {
  const actions = userConfig.value.mainActions
  if (!removedIds.length || !actions) return
  userConfig.value.mainActions = Object.fromEntries(
    Object.entries(actions).filter(
      ([, action]) =>
        !action || !removedIds.some((id) => props.isMainActionOf(action, id))
    )
  )
}

function moveItem(from: number, to: number) {
  setLibrary(moveSlotItem(library(), from, to))
}

function addItem(index: number) {
  setLibrary(
    placeNewSlotItem(library(), index, {
      id: nextNumberedId(library().items, props.idPrefix),
      name: '',
      rule: '',
    })
  )
}

function removeItem(index: number) {
  const itemId = library().slots[SHORTCUT_SLOT_KEYS[index]!]
  setLibrary(removeSlotItemAt(library(), index))
  if (itemId) dropMainActions([itemId])
}

function updateItem(
  index: number,
  field: keyof SlotLibraryItem,
  value: unknown
) {
  const item = slots.value[index]
  if (typeof value !== 'string' || !item) return
  setLibrary(updateSlotItem(library(), item.id, { [field]: value }))
}

onUnmounted(() => {
  const current = library()
  const cleaned = withoutEmptySlotItems(current)
  if (cleaned.items.length === current.items.length) return
  const keptIds = new Set(cleaned.items.map((item) => item.id))
  setLibrary(cleaned)
  dropMainActions(
    current.items.filter((item) => !keptIds.has(item.id)).map((item) => item.id)
  )
})
</script>
