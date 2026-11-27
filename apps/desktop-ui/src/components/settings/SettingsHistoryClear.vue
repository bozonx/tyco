<template>
  <Button
    size="sm"
    variant="ghost"
    icon="mdi:trash-can-outline"
    :loading="isClearing"
    :disabled="isEmpty"
    @click="isConfirmOpen = true"
  >
    {{ t('history.clear') }}
  </Button>
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

/**
 * The clear button in the header of a history section. Clearing is the only way
 * the settings delete a history: turning it off never does, see
 * `createHistoryKeepingModel`
 */
const props = defineProps<{
  confirmTitle: string
  confirmMessage: string
  isEmpty?: boolean
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
