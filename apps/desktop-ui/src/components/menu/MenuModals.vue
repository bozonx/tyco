<template>
  <Overlay v-if="menuModalsStore.currentModal !== MenuModals.NONE">
    <!-- keyed by step: a correction step over an insert one is a new screen -->
    <InsertMenu
      v-if="menuModalsStore.currentModal === MenuModals.INSERT"
      :key="menuModalsStore.currentStepId"
      v-bind="menuModalsStore.currentModalParams"
    />
    <AiTaskMenu
      v-else-if="menuModalsStore.currentModal === MenuModals.AI_TASK"
      v-bind="menuModalsStore.currentModalParams"
    />
    <DiffMenu
      v-else-if="menuModalsStore.currentModal === MenuModals.DIFF"
      v-bind="menuModalsStore.currentModalParams as any"
    />
    <VoiceRecognitionMenu
      v-else-if="menuModalsStore.currentModal === MenuModals.VOICE_RECOGNITION"
      v-bind="menuModalsStore.currentModalParams"
      @cancelled="handleVoiceCancelled"
      @corrected="handleVoiceCorrected"
    />
    <TranslateMenu
      v-else-if="menuModalsStore.currentModal === MenuModals.TRANSLATE"
      v-bind="menuModalsStore.currentModalParams as any"
    />
    <PreviewMenu
      v-else-if="menuModalsStore.currentModal === MenuModals.PREVIEW"
      v-bind="menuModalsStore.currentModalParams as any"
    />
    <ActionSelectModal
      v-else-if="menuModalsStore.currentModal === MenuModals.ACTION_SELECT"
      v-bind="menuModalsStore.currentModalParams as any"
    />
  </Overlay>

  <Overlay :navBarVisible="false" v-if="menuModalsStore.pendingModal">
    <InProgressMessage v-bind="menuModalsStore.pendingModal" />
  </Overlay>
</template>

<script setup lang="ts">
import { MenuModals, useMenuModalsStore } from '../../stores/menuModals'
import ActionSelectModal from './ActionSelectModal.vue'

const menuModalsStore = useMenuModalsStore()

function handleVoiceCancelled() {
  menuModalsStore.closeAll()
}

function handleVoiceCorrected() {
  menuModalsStore.closeAll()
}
</script>
