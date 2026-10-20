<template>
  <ContentPadding>
    <div class="editor-view">
      <Editor v-if="desktopStore.desktopState" :compact="false" />
    </div>
  </ContentPadding>
</template>

<script setup lang="ts">
import { onMounted, onScopeDispose, onUnmounted } from 'vue'

import ContentPadding from '../components/common/ContentPadding.vue'
import Editor from '../components/editor/Editor.vue'
import { useDismissibleLayer } from '../composables/use-dismissible-layer'
import { isCtrlEnter } from '../lib/input-keys/input-keys'
import { useDesktopStore } from '../stores/desktop'
import { useEditorInputStore } from '../stores/editor-input'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'
import { useWindowStore } from '../stores/window'

const windowStore = useWindowStore()

const desktopStore = useDesktopStore()
const navPanelStore = useNavPanelStore()
const menuModalsStore = useMenuModalsStore()
const editorInputStore = useEditorInputStore()

async function closeEditor() {
  await windowStore.hide()
}

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
  dismiss: () => {
    void closeEditor()
  },
})

function handleKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  if (menuModalsStore.hasOpenModal || menuModalsStore.pendingModal) return
  // Enter breaks lines in the editor whatever the submit key is
  if (isCtrlEnter(event)) {
    event.preventDefault()
    if (!event.repeat) {
      openInsertMenu()
    }
  }
}

onMounted(() => window.addEventListener('keydown', handleKeyDown))
onUnmounted(() => window.removeEventListener('keydown', handleKeyDown))
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
