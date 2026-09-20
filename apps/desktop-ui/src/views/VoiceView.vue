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
import { ref } from 'vue'

import { appNavigation } from '../lib/navigation/navigation'
import { APP_ROUTES } from '../lib/navigation/routes'
import { useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'

const navPanelStore = useNavPanelStore()
const menuModalsStore = useMenuModalsStore()
const isInsertMenu = ref(false)
const resText = ref('')

navPanelStore.resetNavParams({
  panelVisible: false,
})

function handleCorrected(resultText: string) {
  resText.value = resultText
  isInsertMenu.value = true
}

function handleCancelled() {
  void appNavigation.push(APP_ROUTES.EDITOR.path)
}
</script>
