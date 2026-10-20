<template>
  <ContentPadding>
    <InProgressMessage v-if="isStarting" correction :on-cancel="handleCancel" />
    <ActionOverlayLayout
      v-else
      :title="t('menu.correction')"
      :on-esc="handleCancel"
    >
      <p class="p-4 text-center">{{ emptyMessage }}</p>
    </ActionOverlayLayout>
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'

import ContentPadding from '../components/common/ContentPadding.vue'
import InProgressMessage from '../components/menu/InProgressMessage.vue'
import ActionOverlayLayout from '../components/overlay/ActionOverlayLayout.vue'
import { useDismissibleLayer } from '../composables/use-dismissible-layer'
import { useI18n } from '../composables/use-i18n'
import useToast from '../composables/use-toast'
import { createCorrectionMode } from '../lib/correction/correction-mode'
import { useActionMenuStore } from '../stores/action-menu'
import { useDesktopStore } from '../stores/desktop'
import { useNavPanelStore } from '../stores/nav-panel'
import { useWindowStore } from '../stores/window'
import { APP_CONFIG } from '@tyco/shared'

const actionMenuStore = useActionMenuStore()
const windowStore = useWindowStore()
const desktopStore = useDesktopStore()
const navPanelStore = useNavPanelStore()
const isStarting = ref(false)
const { t } = useI18n()
const { toastText } = useToast()
const viewActivationId = desktopStore.desktopState.activationId
let unmounted = false
const isCurrent = () =>
  !unmounted &&
  desktopStore.desktopState.activationId === viewActivationId &&
  desktopStore.desktopState.mode === 'correction' &&
  desktopStore.desktopState.isWindowShown
const emptyMessage = computed(() => {
  const text = desktopStore.desktopState.selectedText
  if (!text?.trim()) return t('toast.textNotSelected')
  const minLength = APP_CONFIG.minCorrectionLength
  return t(
    text.length < minLength
      ? 'toast.textTooShortForCorrection'
      : 'write.correctionFailed'
  )
})

navPanelStore.resetNavPanelState({ panelVisible: false })

function handleCancel() {
  if (!isCurrent()) return
  isStarting.value = false
  void windowStore.hide()
}

const correctionMode = createCorrectionMode({
  // the selection was taken to be corrected and put back: nothing else to do
  startCorrection: (text) =>
    actionMenuStore.correct(text, { insertOnly: true, onCancel: handleCancel }),
  setPending: (pending) => {
    isStarting.value = pending
  },
})

watch(
  () =>
    [
      desktopStore.desktopState.selectedText,
      desktopStore.desktopState.activationId,
    ] as const,
  ([text, activationId]) => {
    if (!isCurrent()) return
    void correctionMode.consume(text, activationId).catch((error: unknown) => {
      if (isCurrent()) toastText(String(error), 'error')
    })
  },
  { immediate: true }
)

useDismissibleLayer({
  isOpen: () => true,
  elements: () => [],
  canDismissOutside: false,
  dismiss: handleCancel,
})

onUnmounted(() => {
  unmounted = true
  correctionMode.dispose()
})
</script>
