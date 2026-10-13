<template>
  <ContentPadding>
    <InsertMenu
      :allowInsertButton="false"
      :text="text"
      :shortcutsDisabled="shortcutsDisabled"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useEditorInputStore } from '../stores/editor-input'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'

const menuModalsStore = useMenuModalsStore()
const navPanelStore = useNavPanelStore()
const ipcStore = useIpcStore()
const editorInputStore = useEditorInputStore()
const text = computed(
  () =>
    ipcStore.desktopState?.selectedText ||
    editorInputStore.selectedText ||
    editorInputStore.value ||
    ''
)

// The view outlives a hidden window. Until the next activation reaches it, the
// keys belong to whatever mode that activation opens
const shortcutsDisabled = computed(
  () => menuModalsStore.anyModalOpen || !ipcStore.desktopState.isWindowShown
)

navPanelStore.resetNavParams({})
</script>
