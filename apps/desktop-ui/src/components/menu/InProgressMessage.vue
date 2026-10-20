<template>
  <div class="in-progress">
    <StateMessage
      kind="loading"
      :message="
        props.label ||
        (props.ai
          ? t('menu.aiRequest')
          : props.correction
            ? t('menu.correction')
            : t('common.inProgress'))
      "
      icon="mdi:progress-clock"
    />
    <Button type="button" @click="handleCancel" variant="ghost" size="sm">
      {{ t('common.cancel') }}
    </Button>
  </div>
</template>

<script setup lang="ts">
import { useDismissibleLayer } from '../../composables/use-dismissible-layer'
import { useI18n } from '../../composables/use-i18n'
import type { PendingModalParams } from '../../lib/modals/menu-modal-params'
import { useMenuModalsStore } from '../../stores/menu-modals'
import Button from '../common/Button.vue'
import StateMessage from '../common/StateMessage.vue'

const props = withDefaults(defineProps<PendingModalParams>(), {
  ai: false,
  correction: false,
})

const menuModalsStore = useMenuModalsStore()
const { t } = useI18n()

function handleCancel() {
  if (props.onCancel) {
    props.onCancel()
  } else {
    menuModalsStore.cancelPending()
  }
}

useDismissibleLayer({
  isOpen: () => true,
  elements: () => [],
  canDismissOutside: false,
  dismiss: handleCancel,
})
</script>

<style scoped>
.in-progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  width: 100%;
  height: 100%;
}
</style>
