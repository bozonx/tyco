<template>
  <ContentPadding>
    <div class="editor-view">
      <Editor v-if="ipcStore.params" :compact="false" />
    </div>
  </ContentPadding>
</template>

<script setup lang="ts">
import Editor from '../components/Editor.vue'
import ContentPadding from '../components/common/ContentPadding.vue'
import { useEditorInputStore } from '../stores/editorInput'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'

const ipcStore = useIpcStore()
const navPanelStore = useNavPanelStore()
const menuModalsStore = useMenuModalsStore()
const editorInputStore = useEditorInputStore()

navPanelStore.resetNavParams({
  escBtnAction: () => {
    menuModalsStore.nextModal(MenuModals.INSERT, {
      text: editorInputStore.value,
    })
  },
  escBtnLabelKey: 'menu.insert',
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
