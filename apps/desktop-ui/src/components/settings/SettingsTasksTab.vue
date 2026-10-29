<template>
  <div class="settings-stack">
    <SettingsSection :description="t('settings.tasksHint')">
      <SettingsTaskModel task="aiTask" />
    </SettingsSection>
    <SettingsSection bare>
      <ShortcutSlots
        :items="taskSlots"
        @move="moveTask"
        @add="addTask"
        @remove="removeTask"
      >
        <template #item="{ item, index }">
          <div class="flex flex-col gap-2 w-full">
            <FieldInput
              :model-value="item.name"
              :placeholder="t('settings.name')"
              class="font-medium"
              @update:model-value="updateTask(index, 'name', $event)"
            />
            <FieldTextArea
              :model-value="item.rule"
              :placeholder="t('settings.rule')"
              @update:model-value="updateTask(index, 'rule', $event)"
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
  type AiTaskLibrary,
  moveTaskSlot,
  placeNewTask,
  removeTaskAt,
  taskSlotList,
  updateAiTask,
  withoutEmptyTasks,
} from '../../lib/ai-tasks/ai-task-library'
import {
  type AiTaskConfig,
  newAiTaskId,
} from '../../lib/ai-tasks/custom-prompt'
import FieldInput from '../common/FieldInput.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'
import ShortcutSlots from './ShortcutSlots.vue'
import { SHORTCUT_SLOT_KEYS } from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()

const taskSlots = computed(() => taskSlotList(userConfig.value.aiTasks))

function setLibrary(library: AiTaskLibrary) {
  userConfig.value.aiTasks = library
}

function moveTask(from: number, to: number) {
  setLibrary(moveTaskSlot(userConfig.value.aiTasks, from, to))
}

function addTask(index: number) {
  setLibrary(
    placeNewTask(userConfig.value.aiTasks, index, {
      id: newAiTaskId(userConfig.value.aiTasks.items),
      name: '',
      rule: '',
    })
  )
}

function removeTask(index: number) {
  const taskId = userConfig.value.aiTasks.slots[SHORTCUT_SLOT_KEYS[index]!]
  setLibrary(removeTaskAt(userConfig.value.aiTasks, index))
  if (taskId && userConfig.value.mainActions) {
    userConfig.value.mainActions = Object.fromEntries(
      Object.entries(userConfig.value.mainActions).filter(
        ([, action]) => action?.type !== 'aiTask' || action.taskId !== taskId
      )
    )
  }
}

function updateTask(index: number, field: keyof AiTaskConfig, value: unknown) {
  const task = taskSlots.value[index]
  if (typeof value !== 'string' || !task) return
  setLibrary(
    updateAiTask(userConfig.value.aiTasks, task.id, { [field]: value })
  )
}

onUnmounted(() => {
  const cleaned = withoutEmptyTasks(userConfig.value.aiTasks)
  if (cleaned.items.length !== userConfig.value.aiTasks.items.length)
    setLibrary(cleaned)
})
</script>
