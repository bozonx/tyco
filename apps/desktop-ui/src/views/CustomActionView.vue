<template>
  <div class="custom-action-view" />
</template>

<script setup lang="ts">
import { onMounted } from 'vue'

import { useActionMenuStore } from '../stores/action-menu'
import { useDesktopStore } from '../stores/desktop'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menu-modals'

const desktopStore = useDesktopStore()
const actionMenuStore = useActionMenuStore()
const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()

onMounted(async () => {
  const slotIndex = desktopStore.desktopState.customActionIndex ?? 0
  const slot = desktopStore.userConfig.customActionSlots?.[slotIndex]
  const text = desktopStore.desktopState.selectedText ?? ''

  if (slot?.action) {
    const actionItem = actionMenuStore.resolveActionItem(slot.action)
    if (actionItem) {
      await actionItem.action(text)
      if (
        !menuModalsStore.hasOpenModal &&
        !menuModalsStore.pendingModal &&
        slot.action.type !== 'actionPage'
      ) {
        await ipcStore.call('hide_window')
      }
      return
    }
  }

  await ipcStore.call('hide_window')
})
</script>
