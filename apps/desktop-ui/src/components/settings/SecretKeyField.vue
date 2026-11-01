<template>
  <div class="secret-key-field" @keydown.enter.prevent="saveTyped">
    <FieldInput
      class="flex-1"
      type="password"
      :model-value="modelValue"
      :disabled="isBusy"
      :aria-label="t('settings.apiKey')"
      :placeholder="
        hasKey
          ? t('settings.apiKeyReplacePlaceholder')
          : t('settings.apiKeyNotSetPlaceholder')
      "
      @update:model-value="emit('update:modelValue', $event)"
    />
    <Button
      variant="primary"
      size="sm"
      :disabled="isBusy || !modelValue.trim()"
      @click="run(save)"
      >{{ t('settings.saveKey') }}</Button
    >
    <Button
      v-if="hasKey"
      size="sm"
      variant="ghost"
      :disabled="isBusy"
      @click="run(remove)"
      >{{ t('settings.removeKey') }}</Button
    >
  </div>
</template>
<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import Button from '../common/Button.vue'
import FieldInput from '../common/FieldInput.vue'

const props = defineProps<{
  modelValue: string
  hasKey: boolean
  save: () => Promise<void>
  remove: () => Promise<void>
}>()
const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()
const { t } = useI18n()
const isBusy = ref(false)
async function run(action: () => Promise<void>) {
  if (isBusy.value) return
  isBusy.value = true
  try {
    await action()
  } finally {
    isBusy.value = false
  }
}
function saveTyped() {
  if (props.modelValue.trim()) void run(props.save)
}
// everything else on the page saves itself: a typed key is not lost by
// leaving the page before pressing Save
onBeforeUnmount(saveTyped)
</script>
<style scoped>
.secret-key-field {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
}
</style>
