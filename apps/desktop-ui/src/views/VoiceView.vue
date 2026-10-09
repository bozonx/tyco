<template>
  <!-- the bar sits at the bottom like the quick input, without padding -->
  <div v-if="props.bar && !isInsertMenu" class="voice-bar-layer">
    <VoiceRecognitionMenu
      variant="bar"
      with-next
      @corrected="handleCorrected"
      @cancelled="handleCancelled"
    />
  </div>
  <ContentPadding v-else>
    <VoiceRecognitionMenu
      v-if="!isInsertMenu"
      with-next
      @corrected="handleCorrected"
      @cancelled="handleCancelled"
    />
    <InsertMenu
      v-else
      :text="resText"
      :allowInsertButton="true"
      :stopListening="menuModalsStore.anyModalOpen"
    />
  </ContentPadding>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import { appNavigation } from '../lib/navigation/navigation'
import { APP_ROUTES } from '../lib/navigation/routes'
import type { VoiceFinishIntent } from '../lib/stt/voice-finish-intent'
import { useActionMenuStore } from '../stores/actionMenu'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'
import { getCurrentWindow } from '@tauri-apps/api/window'

const props = withDefaults(
  defineProps<{
    /** Dictate in a bar at the bottom of the screen, as the quick window does */
    bar?: boolean
  }>(),
  { bar: false }
)

const emit = defineEmits<{
  /** The dictation is over and its result is shown in the insert menu */
  (e: 'result-shown', shown: boolean): void
}>()

const navPanelStore = useNavPanelStore()
const menuModalsStore = useMenuModalsStore()
const ipcStore = useIpcStore()
const actionMenuStore = useActionMenuStore()
const isInsertMenu = ref(false)
const resText = ref('')

navPanelStore.resetNavParams({ panelVisible: false })

watch(isInsertMenu, (shown) => emit('result-shown', shown), { immediate: true })

watch(
  () => [ipcStore.params?.isWindowShown, ipcStore.params?.mode],
  ([isShown, mode]) => {
    if (!isShown || mode !== 'voice') {
      isInsertMenu.value = false
      resText.value = ''
    }
  }
)

function handleCorrected(
  resultText: string,
  _recognizedText: string,
  _correctedText: string | undefined,
  intent: VoiceFinishIntent
) {
  const insertAction = actionMenuStore
    .getDefaultActions()
    .find((action) => action.id === 'insertIntoWindow')
  // without a target window the text stays in the actions step, not lost
  if (intent !== 'next' && insertAction && ipcStore.params?.windowId) {
    void insertAction.action(resultText)
    return
  }
  resText.value = resultText
  isInsertMenu.value = true
}

function handleCancelled() {
  if (!ipcStore.params.isWindowShown || ipcStore.params.mode !== 'voice') return

  if (getCurrentWindow().label === 'quick') {
    void ipcStore.callFunctionOrNotify('closeWindow')
  } else {
    void appNavigation.push(APP_ROUTES.EDITOR.path)
  }
}
</script>

<style scoped>
.voice-bar-layer {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  width: 100%;
  height: 100%;
}
</style>
