<template>
  <!-- an inline voice input is drawn by the editor itself -->
  <Overlay v-if="menuModalsStore.currentStep && !isInlineVoice">
    <!-- keyed by step: a correction step over an insert one is a new screen -->
    <InsertMenu
      v-if="menuModalsStore.currentStep?.modal === MenuModals.INSERT"
      :key="menuModalsStore.currentStepId"
      v-bind="menuModalsStore.currentStep.params"
    />
    <AiTaskMenu
      v-else-if="menuModalsStore.currentStep?.modal === MenuModals.AI_TASK"
      :key="menuModalsStore.currentStepId"
      v-bind="menuModalsStore.currentStep.params"
    />
    <TransformationMenu
      v-else-if="
        menuModalsStore.currentStep?.modal === MenuModals.TRANSFORMATION
      "
      :key="menuModalsStore.currentStepId"
      v-bind="menuModalsStore.currentStep.params"
    />
    <StylingMenu
      v-else-if="menuModalsStore.currentStep?.modal === MenuModals.STYLING"
      :key="menuModalsStore.currentStepId"
      v-bind="menuModalsStore.currentStep.params"
    />
    <DiffMenu
      v-else-if="menuModalsStore.currentStep?.modal === MenuModals.DIFF"
      :key="menuModalsStore.currentStepId"
      v-bind="menuModalsStore.currentStep.params"
    />
    <VoiceRecognitionMenu
      v-else-if="
        menuModalsStore.currentStep?.modal === MenuModals.VOICE_RECOGNITION
      "
      :key="menuModalsStore.currentStepId"
      v-bind="menuModalsStore.currentStep.params"
      @cancelled="handleVoiceCancelled"
      @corrected="handleVoiceCorrected"
    />
    <TranslateMenu
      v-else-if="menuModalsStore.currentStep?.modal === MenuModals.TRANSLATE"
      :key="menuModalsStore.currentStepId"
      v-bind="menuModalsStore.currentStep.params"
    />
    <PreviewMenu
      v-else-if="menuModalsStore.currentStep?.modal === MenuModals.PREVIEW"
      :key="menuModalsStore.currentStepId"
      v-bind="menuModalsStore.currentStep.params"
    />
    <ActionSelectModal
      v-else-if="
        menuModalsStore.currentStep?.modal === MenuModals.ACTION_SELECT
      "
      :key="menuModalsStore.currentStepId"
      v-bind="menuModalsStore.currentStep.params"
    />
  </Overlay>

  <Overlay :nav-bar-visible="false" v-if="menuModalsStore.pendingModal">
    <InProgressMessage v-bind="menuModalsStore.pendingModal" />
  </Overlay>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import Overlay from '../overlay/Overlay.vue'
import ActionSelectModal from './ActionSelectModal.vue'
import AiTaskMenu from './AiTaskMenu.vue'
import DiffMenu from './DiffMenu.vue'
import InProgressMessage from './InProgressMessage.vue'
import InsertMenu from './InsertMenu.vue'
import PreviewMenu from './PreviewMenu.vue'
import StylingMenu from './StylingMenu.vue'
import TransformationMenu from './TransformationMenu.vue'
import TranslateMenu from './TranslateMenu.vue'
import VoiceRecognitionMenu from './VoiceRecognitionMenu.vue'

const menuModalsStore = useMenuModalsStore()

const isInlineVoice = computed(() => {
  const step = menuModalsStore.currentStep
  return (
    step?.modal === MenuModals.VOICE_RECOGNITION && Boolean(step.params.inline)
  )
})

function handleVoiceCancelled() {
  menuModalsStore.closeAll()
}

function handleVoiceCorrected() {
  menuModalsStore.closeAll()
}
</script>
