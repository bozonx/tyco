<template>
  <div class="secret-key-field">
    <FieldInput
      class="flex-1"
      type="password"
      :value="value"
      :disabled="isBusy"
      :aria-label="t('settings.apiKey')"
      :placeholder="
        hasKey
          ? t('settings.apiKeyReplacePlaceholder')
          : t('settings.apiKeyPlaceholder')
      "
      @update:value="emit('update:value', $event)"
    />
    <Button size="sm" :disabled="isBusy || !value.trim()" @click="run(save)">{{
      t('settings.saveKey')
    }}</Button>
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
import { ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import Button from '../common/Button.vue'
import FieldInput from '../common/FieldInput.vue'

defineProps<{
  value: string
  hasKey: boolean
  save: () => Promise<void>
  remove: () => Promise<void>
}>()
const emit = defineEmits<{ (e: 'update:value', value: string): void }>()
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
</script>
<style scoped>
.secret-key-field {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: 100%;
}
</style>
