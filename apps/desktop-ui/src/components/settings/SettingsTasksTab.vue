<template>
  <SettingsSection :description="t('settings.tasksHint')" bare>
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
</template>

<script setup lang="ts">
import { computed, onUnmounted } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { newAiTaskId } from '../../lib/ai-tasks/custom-prompt'
import {
  moveShortcutSlot,
  normalizeShortcutSlots,
} from '../../lib/shortcut-slots/shortcut-slots'
import FieldInput from '../common/FieldInput.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import SettingsSection from './SettingsSection.vue'
import ShortcutSlots from './ShortcutSlots.vue'

const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()

type AiTask = { id: string; name: string; rule: string }

const taskSlots = computed(() =>
  normalizeShortcutSlots<AiTask>(userConfig.value.aiTasks)
)

function setSlots(slots: (AiTask | null)[]) {
  userConfig.value.aiTasks = slots
}

function moveTask(from: number, to: number) {
  setSlots(moveShortcutSlot(taskSlots.value, from, to))
}

function addTask(index: number) {
  const slots = [...taskSlots.value]
  slots[index] = { id: newAiTaskId(slots), name: '', rule: '' }
  setSlots(slots)
}

function removeTask(index: number) {
  const slots = [...taskSlots.value]
  slots[index] = null
  setSlots(slots)
}

function updateTask(index: number, field: keyof AiTask, value: unknown) {
  if (typeof value !== 'string' || !taskSlots.value[index]) return
  const slots = [...taskSlots.value]
  slots[index] = { ...slots[index]!, [field]: value }
  setSlots(slots)
}

onUnmounted(() => {
  const hasEmpty = taskSlots.value.some(
    (task) => task && !task.name.trim() && !task.rule.trim()
  )
  if (hasEmpty) {
    const cleaned = taskSlots.value.map((task) =>
      task && (task.name.trim() || task.rule.trim()) ? task : null
    )
    setSlots(cleaned)
  }
})
</script>
