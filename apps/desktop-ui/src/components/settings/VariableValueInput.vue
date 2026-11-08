<template>
  <div class="variable-value-input">
    <FieldInput
      ref="inputRef"
      class="variable-value-field"
      :model-value="modelValue"
      :placeholder="t('variables.valuePlaceholder')"
      :data-testid="testId"
      @update:model-value="emit('update:modelValue', String($event))"
    />
    <DropdownMenu
      size="sm"
      align="right"
      icon="mdi:folder-search-outline"
      :label="t('variables.browse')"
      :items="browseItems"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useIpcStore } from '../../stores/ipc'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import FieldInput from '../common/FieldInput.vue'

/** The value of a variable on this device; a path may be picked */
defineProps<{ modelValue: string; testId?: string }>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const { t } = useI18n()
const ipc = useIpcStore()
const inputRef = ref<{ focus?: () => void } | null>(null)

async function pick(command: 'pick_directory' | 'pick_file') {
  const result = await ipc.callOrNotify(command)
  if (typeof result.result === 'string')
    emit('update:modelValue', result.result)
}

const browseItems: DropdownMenuItem[] = [
  {
    label: t('variables.browseFolder'),
    icon: 'mdi:folder-outline',
    action: () => pick('pick_directory'),
  },
  {
    label: t('variables.browseFile'),
    icon: 'mdi:file-outline',
    action: () => pick('pick_file'),
  },
]

defineExpose({ focus: () => inputRef.value?.focus?.() })
</script>

<style scoped>
.variable-value-input {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  width: 100%;
}

.variable-value-field {
  flex: 1;
  min-width: 12rem;
}
</style>
