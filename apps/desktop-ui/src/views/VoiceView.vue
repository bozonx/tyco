<template>
  <ContentPadding>
    <VoiceRecognitionMenu
      v-if="!isInsertMenu"
      @corrected="handleCorrected"
      @cancelled="handleCancelled"
    />
    <InsertMenu
      v-else
      :text="resText"
      :allowInsertButton="false"
      :stopListening="menuModalsStore.anyModalOpen"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import { appNavigation } from '../lib/navigation/navigation'
import { APP_ROUTES } from '../lib/navigation/routes'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'
import { getCurrentWindow } from '@tauri-apps/api/window'

const navPanelStore = useNavPanelStore()
const menuModalsStore = useMenuModalsStore()
const ipcStore = useIpcStore()
const isInsertMenu = ref(false)
const resText = ref('')

navPanelStore.resetNavParams({ panelVisible: false })

watch(
  () => [ipcStore.params?.isWindowShown, ipcStore.params?.mode],
  ([isShown, mode]) => {
    if (!isShown || mode !== 'voice') {
      isInsertMenu.value = false
      resText.value = ''
    }
  }
)

function handleCorrected(resultText: string) {
  resText.value = resultText
  isInsertMenu.value = true
}

function handleCancelled() {
  if (!ipcStore.params.isWindowShown || ipcStore.params.mode !== 'voice') return

  if (getCurrentWindow().label === 'quick') {
    void ipcStore.callFunction('closeWindow', [])
  } else {
    void appNavigation.push(APP_ROUTES.EDITOR.path)
  }
}
</script>
