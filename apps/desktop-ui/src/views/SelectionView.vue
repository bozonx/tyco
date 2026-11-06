<template>
  <ContentPadding>
    <InsertMenu
      :allow-insert-button="false"
      :text="text"
      :shortcuts-disabled="shortcutsDisabled"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

import ContentPadding from '../components/common/ContentPadding.vue'
import InsertMenu from '../components/menu/InsertMenu.vue'
import { useSelectionActionContext } from '../composables/use-selection-action-context'
import { desktopClient } from '../lib/desktop/client'
import { useActionMenuStore } from '../stores/action-menu'
import { useDesktopStore } from '../stores/desktop'
import { useMenuModalsStore } from '../stores/menu-modals'
import { DESKTOP_EVENTS } from '@tyco/shared'

const { text, shortcutsDisabled } = useSelectionActionContext()
const actionMenuStore = useActionMenuStore()
const desktopStore = useDesktopStore()
const menuModalsStore = useMenuModalsStore()

let stopPageTurn: (() => void) | undefined
let unmounted = false

onMounted(() => {
  actionMenuStore.openPage(desktopStore.desktopState.actionPageIndex ?? 0)
  void desktopClient
    .listen(DESKTOP_EVENTS.ACTION_PAGE_TURN, ({ activationId, pageIndex }) => {
      if (
        activationId !== desktopStore.desktopState.activationId ||
        !desktopStore.desktopState.isWindowShown ||
        desktopStore.desktopState.mode !== 'selectionActions'
      ) {
        return
      }
      if (menuModalsStore.hasOpenModal || menuModalsStore.pendingModal) {
        menuModalsStore.cancelAndCloseAll()
      }
      actionMenuStore.repeatOpenPage(pageIndex)
    })
    .then((stop) => {
      if (unmounted) stop()
      else stopPageTurn = stop
    })
    .catch(() => undefined)
})

onUnmounted(() => {
  unmounted = true
  stopPageTurn?.()
})
</script>
