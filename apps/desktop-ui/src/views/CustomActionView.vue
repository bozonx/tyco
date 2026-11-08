<template>
  <div class="custom-action-view" />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'

import {
  isQuickWindowModeSwitchingAction,
  waitForCapturedSelection,
} from '../lib/action-menu/custom-action-executor'
import { useActionMenuStore } from '../stores/action-menu'
import { useDesktopStore } from '../stores/desktop'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menu-modals'

const desktopStore = useDesktopStore()
const actionMenuStore = useActionMenuStore()
const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()

let unmounted = false
onUnmounted(() => {
  unmounted = true
})

onMounted(async () => {
  const slotIndex = desktopStore.desktopState.customActionIndex ?? 0
  const slot = desktopStore.userConfig.customActionSlots?.[slotIndex]

  if (!slot?.action) {
    await ipcStore.call('hide_window')
    return
  }

  const initialActivationId = desktopStore.desktopState.activationId
  const initialRevision = desktopStore.desktopState.revision

  let text = desktopStore.desktopState.selectedText ?? ''
  if (slot.takesSelection && !text.trim()) {
    text = await waitForCapturedSelection(
      {
        getSelectedText: () => desktopStore.desktopState.selectedText,
        getRevision: () => desktopStore.desktopState.revision,
        getActivationId: () => desktopStore.desktopState.activationId,
        watchState: (callback) =>
          watch(
            () =>
              [
                desktopStore.desktopState.selectedText,
                desktopStore.desktopState.revision,
                desktopStore.desktopState.activationId,
              ] as const,
            ([selectedText, revision, activationId]) => {
              callback({ selectedText, revision, activationId })
            }
          ),
      },
      initialActivationId,
      initialRevision
    )
  }

  if (
    unmounted ||
    desktopStore.desktopState.activationId !== initialActivationId
  ) {
    return
  }

  const actionItem = actionMenuStore.resolveActionItem(slot.action)
  if (!actionItem) {
    await ipcStore.call('hide_window')
    return
  }

  await actionItem.action(text)

  if (unmounted) return

  const isModeSwitching = isQuickWindowModeSwitchingAction(slot.action)

  if (
    !menuModalsStore.hasOpenModal &&
    !menuModalsStore.pendingModal &&
    !isModeSwitching &&
    desktopStore.desktopState.mode === 'customAction'
  ) {
    await ipcStore.call('hide_window')
  }
})
</script>
