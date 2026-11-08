<template>
  <Button
    size="xs"
    variant="ghost"
    icon="mdi:trash-can-outline"
    class="clear-btn"
    tone="muted"
    @click="isConfirmOpen = true"
  >
    {{ t('history.clear') }}
  </Button>
  <ConfirmModal
    :open="isConfirmOpen"
    :title="t('history.clear')"
    :message="t('history.clearConfirm', { count: totalCount })"
    :confirm-text="t('history.clearConfirmButton')"
    danger
    @confirm="confirmClear"
    @cancel="isConfirmOpen = false"
  />
</template>
<script setup lang="ts">
import { ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'

defineProps<{ totalCount: number }>()
const emit = defineEmits<{ clear: [] }>()
const { t } = useI18n()
const isConfirmOpen = ref(false)

function confirmClear() {
  isConfirmOpen.value = false
  emit('clear')
}
</script>
