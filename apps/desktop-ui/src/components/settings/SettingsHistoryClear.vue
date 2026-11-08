<template>
  <FieldRow :label="t('history.clear')" :hint="countHint" inline>
    <Button
      size="sm"
      variant="ghost"
      icon="mdi:trash-can-outline"
      :loading="isClearing"
      @click="isConfirmOpen = true"
    >
      {{ label }}
    </Button>
  </FieldRow>
  <ConfirmModal
    :open="isConfirmOpen"
    :title="confirmTitle"
    :message="confirmMessage"
    :confirm-text="t('history.clearConfirmButton')"
    danger
    @confirm="clearHistory"
    @cancel="isConfirmOpen = false"
  />
</template>
<script setup lang="ts">
import { ref } from 'vue'

import { useBusyAction } from '../../composables/use-busy-action'
import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldRow from '../common/FieldRow.vue'

const props = defineProps<{
  label: string
  countHint: string
  confirmTitle: string
  confirmMessage: string
  clear: () => Promise<unknown>
}>()
const { t } = useI18n()
const { toastKey } = useToast()
const { isBusy: isClearing, run } = useBusyAction(() =>
  toastKey('history.operationFailed', 'error')
)
const isConfirmOpen = ref(false)
async function clearHistory() {
  if (isClearing.value) return
  isConfirmOpen.value = false
  await run(async () => {
    await props.clear()
    toastKey('history.cleared', 'info')
  })
}
</script>
