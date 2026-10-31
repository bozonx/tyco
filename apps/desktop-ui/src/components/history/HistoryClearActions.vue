<template>
  <template v-if="confirmingClear">
    <span class="text-sm">
      {{ t('history.clearConfirm', { count: totalCount }) }}
    </span>
    <span class="history-toolbar-buttons">
      <Button size="xs" variant="ghost" @click="confirmingClear = false">
        {{ t('common.cancel') }}
      </Button>
      <Button
        size="xs"
        icon="mdi:trash-can-outline"
        class="confirm-clear-btn"
        variant="neutral"
        @click="confirmClear"
      >
        {{ t('history.clearConfirmButton') }}
      </Button>
    </span>
  </template>
  <template v-else>
    <Button
      size="xs"
      variant="ghost"
      icon="mdi:trash-can-outline"
      class="clear-btn"
      tone="muted"
      @click="confirmingClear = true"
    >
      {{ t('history.clear') }}
    </Button>
  </template>
</template>
<script setup lang="ts">
import { ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import Button from '../common/Button.vue'

defineProps<{ totalCount: number }>()
const emit = defineEmits<{ clear: [] }>()
const { t } = useI18n()
const confirmingClear = ref(false)
function confirmClear() {
  confirmingClear.value = false
  emit('clear')
}
</script>
<style scoped>
.history-toolbar-buttons {
  display: flex;
  gap: var(--space-xs);
}
</style>
