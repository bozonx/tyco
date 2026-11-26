<template>
  <div class="editor-view">
    <Editor v-if="desktopStore.desktopState" :compact="false" />
  </div>
</template>

<script setup lang="ts">
import { onScopeDispose } from 'vue'

import Editor from '../components/editor/Editor.vue'
import { useDismissibleLayer } from '../composables/use-dismissible-layer'
import { useDesktopStore } from '../stores/desktop'
import { useEditorInputStore } from '../stores/editor-input'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'

const desktopStore = useDesktopStore()
const navPanelStore = useNavPanelStore()
const menuModalsStore = useMenuModalsStore()
const editorInputStore = useEditorInputStore()

function openInsertMenu() {
  editorInputStore.captureResultSource(editorInputStore.actionText())
  menuModalsStore.nextModal(MenuModals.INSERT, {
    text: editorInputStore.actionText(),
  })
}

navPanelStore.resetNavPanelState({
  onEscape: () => {
    openInsertMenu()
  },
  escapeButtonLabelKey: 'menu.actions',
})
onScopeDispose(() => {
  navPanelStore.resetNavPanelState()
})

useDismissibleLayer({
  isOpen: () => !menuModalsStore.hasOpenModal && !menuModalsStore.pendingModal,
  elements: () => [],
  canDismissOutside: false,
  keyboardPhase: 'bubble',
  dismiss: openInsertMenu,
  // Esc in the editor opens its action menu; Ctrl+W and Ctrl+Q are global
})
</script>

<style scoped>
.editor-view {
  display: flex;
  flex-direction: column;
  flex: 1 1 0%;
  min-height: 0;
  height: 100%;
  width: 100%;
}
</style>
