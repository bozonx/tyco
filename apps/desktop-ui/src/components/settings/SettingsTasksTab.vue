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
            :value="item.name"
            :placeholder="t('settings.name')"
            class="font-medium"
            @update:value="updateTask(index, 'name', $event)"
          />
          <FieldTextArea
            :value="item.rule"
            :placeholder="t('settings.rule')"
            @update:value="updateTask(index, 'rule', $event)"
          />
        </div>
      </template>
    </ShortcutSlots>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import {
  moveShortcutSlot,
  normalizeShortcutSlots,
} from '../../lib/shortcut-slots/shortcut-slots'
import FieldInput from '../common/FieldInput.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import ShortcutSlots from '../common/ShortcutSlots.vue'

const props = defineProps<{ userConfig: Record<string, any> }>()

const emit = defineEmits<{ (e: 'update:aiTasks', value: any[]): void }>()

const { t } = useI18n()

type AiTask = { name: string; rule: string }

const taskSlots = computed(() =>
  normalizeShortcutSlots<AiTask>(props.userConfig.aiTasks)
)

function emitSlots(slots: (AiTask | null)[]) {
  emit('update:aiTasks', slots)
}

function moveTask(from: number, to: number) {
  emitSlots(moveShortcutSlot(taskSlots.value, from, to))
}

function addTask(index: number) {
  const slots = [...taskSlots.value]
  slots[index] = { name: '', rule: '' }
  emitSlots(slots)
}

function removeTask(index: number) {
  const slots = [...taskSlots.value]
  slots[index] = null
  emitSlots(slots)
}

function updateTask(index: number, field: keyof AiTask, value: unknown) {
  if (typeof value !== 'string' || !taskSlots.value[index]) return
  const slots = [...taskSlots.value]
  slots[index] = { ...slots[index]!, [field]: value }
  emitSlots(slots)
}
</script>
