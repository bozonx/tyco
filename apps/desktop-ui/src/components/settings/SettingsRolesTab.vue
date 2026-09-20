<template>
  <div class="settings-roles-tab py-1">
    <FieldItems :items="userConfig.chatRoles" @update:items="updateChatRoles">
      <template #item="{ item, index }">
        <div class="flex flex-row items-start gap-3 w-full">
          <div class="pt-1">
            <KeyButton>{{ PRESETS_KEYS[index] }}</KeyButton>
          </div>
          <div class="flex-1 flex flex-col gap-2 min-w-0">
            <div class="flex flex-col gap-1">
              <label class="text-xs font-medium text-muted">
                {{ t('settings.name') }}
              </label>
              <FieldInput v-model:value="item.name" />
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-xs font-medium text-muted">
                {{ t('settings.rule') }}
              </label>
              <FieldTextArea v-model:value="item.rule" />
            </div>
          </div>
        </div>
      </template>
    </FieldItems>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import { PRESETS_KEYS } from '../../types'
import FieldInput from '../common/FieldInput.vue'
import FieldItems from '../common/FieldItems.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import KeyButton from '../common/KeyButton.vue'

defineProps<{ userConfig: Record<string, any> }>()

const emit = defineEmits<{ (e: 'update:chatRoles', value: any[]): void }>()

const { t } = useI18n()

const updateChatRoles = (items: any[]) => {
  emit('update:chatRoles', items)
}
</script>
