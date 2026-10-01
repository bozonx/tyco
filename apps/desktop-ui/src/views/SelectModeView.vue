<template>
  <ContentPadding>
    <InsertMenu
      :allowInsertButton="false"
      :text="text"
      :stopListening="stopListening"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'

const menuModalsStore = useMenuModalsStore()
const navPanelStore = useNavPanelStore()
const ipcStore = useIpcStore()
const editorInputStore = useEditorInputStore()
const text = computed(
  () =>
    ipcStore.params?.selectedText ||
    editorInputStore.selectedText ||
    editorInputStore.value ||
    ''
)

// The view outlives a hidden window. Until the next activation reaches it, the
// keys belong to whatever mode that activation opens
const stopListening = computed(
  () => menuModalsStore.anyModalOpen || !ipcStore.params.isWindowShown
)

navPanelStore.resetNavParams({})
</script>
