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
import { isCtrlEnter } from '../lib/input-keys/input-keys'
import { useDesktopStore } from '../stores/desktop'
import { useEditorInputStore } from '../stores/editor-input'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'

const ipcStore = useIpcStore()

const desktopStore = useDesktopStore()
const navPanelStore = useNavPanelStore()
const menuModalsStore = useMenuModalsStore()
const editorInputStore = useEditorInputStore()

async function closeEditor() {
  await ipcStore.callFunctionOrNotify('hideWindow')
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

function handleKeyDown(event: KeyboardEvent) {
  if (event.defaultPrevented) return
  if (menuModalsStore.hasOpenModal || menuModalsStore.pendingModal) return
  if (event.code === 'Escape') {
    event.preventDefault()
    if (!event.repeat) {
      void closeEditor()
    }
    return
  }
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
