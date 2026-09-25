<template>
  <ContentPadding>
    <InsertMenu
      :allowInsertButton="false"
      :text="text"
      :stopListening="menuModalsStore.anyModalOpen"
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

navPanelStore.resetNavParams({})
</script>
