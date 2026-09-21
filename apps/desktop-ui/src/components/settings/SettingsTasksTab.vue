<template>
  <SettingsSection :description="t('settings.tasksHint')" bare>
    <FieldItems :items="userConfig.aiTasks" @update:items="updateAiTasks">
      <template #item="{ item, index }">
        <div class="flex flex-col gap-2 w-full">
          <div class="flex items-center gap-2">
            <KeyButton :title="t('settings.hotkey')">{{
              PRESETS_KEYS[index]
            }}</KeyButton>
            <FieldInput
              v-model:value="item.name"
              :placeholder="t('settings.name')"
              class="font-medium"
            />
          </div>
          <FieldTextArea
            v-model:value="item.rule"
            :placeholder="t('settings.rule')"
          />
        </div>
      </template>
    </FieldItems>
  </SettingsSection>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import { PRESETS_KEYS } from '../../types'
import FieldInput from '../common/FieldInput.vue'
import FieldItems from '../common/FieldItems.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import KeyButton from '../common/KeyButton.vue'

defineProps<{ userConfig: Record<string, any> }>()

const emit = defineEmits<{ (e: 'update:aiTasks', value: any[]): void }>()

const { t } = useI18n()

const updateAiTasks = (items: any[]) => {
  emit('update:aiTasks', items)
}
</script>
