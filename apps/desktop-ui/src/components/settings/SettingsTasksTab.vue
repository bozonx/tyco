<template>
  <div>
    <FieldRow :label="t('settings.aiTasks')">
      <FieldItems :items="userConfig.aiTasks" @update:items="updateAiTasks">
        <template #item="{ item, index }">
          <div class="flex flex-row gap-2 w-full">
            <div>
              <KeyButton>{{ PRESETS_KEYS[index] }}</KeyButton>
            </div>
            <div class="flex-1">
              <FieldRow :label="t('settings.name')" vertical>
                <FieldInput v-model:value="item.name" />
              </FieldRow>
              <FieldRow :label="t('settings.rule')" vertical>
                <FieldTextArea v-model:value="item.rule" />
              </FieldRow>
            </div>
          </div>
        </template>
      </FieldItems>
    </FieldRow>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import { PRESETS_KEYS } from '../../types'
import FieldInput from '../common/FieldInput.vue'
import FieldItems from '../common/FieldItems.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import KeyButton from '../common/KeyButton.vue'

defineProps<{ userConfig: Record<string, any> }>()

const emit = defineEmits<{ (e: 'update:aiTasks', value: any[]): void }>()

const { t } = useI18n()

const updateAiTasks = (items: any[]) => {
  emit('update:aiTasks', items)
}
</script>
