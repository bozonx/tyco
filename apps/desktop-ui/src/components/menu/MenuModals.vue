<template>
  <Overlay v-if="menuModalsStore.currentModal !== MenuModals.NONE">
    <InsertMenu v-if="menuModalsStore.currentModal === MenuModals.INSERT" v-bind="menuModalsStore.currentModalParams" />
    <AiTaskMenu v-else-if="menuModalsStore.currentModal === MenuModals.AI_TASK" v-bind="menuModalsStore.currentModalParams" />
    <CorrectionMenu v-else-if="menuModalsStore.currentModal === MenuModals.CORRECTION" v-bind="menuModalsStore.currentModalParams as any" />
    <DiffMenu v-else-if="menuModalsStore.currentModal === MenuModals.DIFF" v-bind="menuModalsStore.currentModalParams as any" />
    <VoiceRecognitionMenu v-else-if="menuModalsStore.currentModal === MenuModals.VOICE_RECOGNITION" v-bind="menuModalsStore.currentModalParams" />
    <TranslateMenu v-else-if="menuModalsStore.currentModal === MenuModals.TRANSLATE" v-bind="menuModalsStore.currentModalParams as any" />
    <PreviewMenu v-else-if="menuModalsStore.currentModal === MenuModals.PREVIEW" v-bind="menuModalsStore.currentModalParams as any" />
    <ActionSelectModal v-else-if="menuModalsStore.currentModal === MenuModals.ACTION_SELECT" v-bind="menuModalsStore.currentModalParams as any" />
  </Overlay>

  <Overlay :navBarVisible="false" v-if="menuModalsStore.pendingModal">
    <InProgressMessage v-bind="menuModalsStore.pendingModal" />
  </Overlay>
</template>

<script setup lang="ts">
import { MenuModals, useMenuModalsStore } from '../../stores/menuModals';
import ActionSelectModal from './ActionSelectModal.vue';

const menuModalsStore = useMenuModalsStore();
</script>