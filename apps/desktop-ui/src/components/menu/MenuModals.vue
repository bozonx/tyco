<template>
  <!-- an inline voice input is drawn by the editor itself -->
  <Overlay
    v-if="menuModalsStore.currentModal !== MenuModals.NONE && !isInlineVoice"
  >
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
      v-bind="diffParams"
    />
    <VoiceRecognitionMenu
      v-else-if="menuModalsStore.currentModal === MenuModals.VOICE_RECOGNITION"
      v-bind="menuModalsStore.currentModalParams"
      @cancelled="handleVoiceCancelled"
      @corrected="handleVoiceCorrected"
    />
    <TranslateMenu
      v-else-if="menuModalsStore.currentModal === MenuModals.TRANSLATE"
      v-bind="menuModalsStore.currentModalParams"
    />
    <PreviewMenu
      v-else-if="menuModalsStore.currentModal === MenuModals.PREVIEW"
      v-bind="previewParams"
    />
    <ActionSelectModal
      v-else-if="menuModalsStore.currentModal === MenuModals.ACTION_SELECT"
      v-bind="actionSelectParams"
    />
  </Overlay>

  <Overlay :navBarVisible="false" v-if="menuModalsStore.pendingModal">
    <InProgressMessage v-bind="menuModalsStore.pendingModal" />
  </Overlay>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { MenuModals, useMenuModalsStore } from '../../stores/menuModals'
import Overlay from '../common/Overlay.vue'
import ActionSelectModal from './ActionSelectModal.vue'
import AiTaskMenu from './AiTaskMenu.vue'
import DiffMenu from './DiffMenu.vue'
import InProgressMessage from './InProgressMessage.vue'
import InsertMenu from './InsertMenu.vue'
import PreviewMenu from './PreviewMenu.vue'
import TranslateMenu from './TranslateMenu.vue'
import VoiceRecognitionMenu from './VoiceRecognitionMenu.vue'

const menuModalsStore = useMenuModalsStore()

const isInlineVoice = computed(
  () =>
    menuModalsStore.currentModal === MenuModals.VOICE_RECOGNITION &&
    Boolean(menuModalsStore.currentModalParams?.inline)
)

const diffParams = computed(
  () =>
    menuModalsStore.currentModalParams as unknown as {
      oldText: string
      newText: string
    }
)

const previewParams = computed(
  () =>
    menuModalsStore.currentModalParams as unknown as {
      text: string
      sourceText?: string
    }
)

const actionSelectParams = computed(
  () =>
    menuModalsStore.currentModalParams as unknown as {
      onSelect: (actionId: string) => void
    }
)

function handleVoiceCancelled() {
  menuModalsStore.closeAll()
}

function handleVoiceCorrected() {
  menuModalsStore.closeAll()
}
</script>
