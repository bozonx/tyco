<template>
  <ContentPadding>
    <InProgressMessage v-if="isStarting" correction :onCancel="handleCancel" />
  </ContentPadding>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import InProgressMessage from '../components/menu/InProgressMessage.vue'
import { createCorrectionMode } from '../lib/correction-mode/correction-mode'
import { useActionMenuStore } from '../stores/actionMenu'
import { useIpcStore } from '../stores/ipc'
import { useNavPanelStore } from '../stores/navPanel'

const actionMenuStore = useActionMenuStore()
const ipcStore = useIpcStore()
const navPanelStore = useNavPanelStore()
const isStarting = ref(false)

navPanelStore.resetNavParams({ panelVisible: false })

function handleCancel() {
  isStarting.value = false
  void ipcStore.callFunctionOrNotify('closeWindow')
}

const correctionMode = createCorrectionMode({
  // the selection was taken to be corrected and put back: nothing else to do
  startCorrection: (text) =>
    actionMenuStore.correct(text, { insertOnly: true, onCancel: handleCancel }),
  setPending: (pending) => {
    isStarting.value = pending
  },
})

watch(
  () => ipcStore.params.selectedText,
  (text) => void correctionMode.consume(text),
  { immediate: true }
)
</script>
