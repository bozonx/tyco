<template>
  <ContentPadding>
    <AiTaskMenu :text="text" :stopListening="menuModalsStore.anyModalOpen" />
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'

const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()
const navPanelStore = useNavPanelStore()
const editorInputStore = useEditorInputStore()
const text = computed(
  () =>
    ipcStore.params?.selectedText ||
    editorInputStore.selectedText ||
    editorInputStore.value ||
    ''
)

navPanelStore.resetNavParams({})
</script>
