<template>
  <ContentPadding>
    <div class="editor-view">
      <Editor v-if="ipcStore.params" :compact="false" />
    </div>
  </ContentPadding>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'

import Editor from '../components/Editor.vue'
import ContentPadding from '../components/common/ContentPadding.vue'
import {
  resolveQuickInputHotkeys,
  resolveQuickInputKeyAction,
} from '../lib/quick-input/quick-input-keys'
import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'

const ipcStore = useIpcStore()
const navPanelStore = useNavPanelStore()
const menuModalsStore = useMenuModalsStore()
const editorInputStore = useEditorInputStore()

async function closeEditor() {
  if (editorInputStore.value.trim()) {
    await editorInputStore.snapshotDraft()
  }
  await ipcStore.callFunctionOrNotify('closeWindow')
}

function openInsertMenu() {
  menuModalsStore.nextModal(MenuModals.INSERT, { text: editorInputStore.value })
}

navPanelStore.resetNavParams({
  escBtnAction: () => {
    openInsertMenu()
  },
  escBtnLabelKey: 'menu.insert',
})

function handleKeyDown(event: KeyboardEvent) {
  if (menuModalsStore.anyModalOpen || menuModalsStore.pendingModal) return
  if (event.code === 'Escape') {
    event.preventDefault()
    if (!event.repeat) {
      void closeEditor()
    }
    return
  }
  const hotkeys = resolveQuickInputHotkeys(
    ipcStore.params?.userConfig?.quickInputHotkeys
  )
  if (resolveQuickInputKeyAction(event, hotkeys) === 'next') {
    if (event.code === 'Tab') return
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
