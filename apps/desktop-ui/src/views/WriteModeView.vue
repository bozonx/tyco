<template>
  <ContentPadding>
    <div class="write-mode-container flex-1 flex flex-col min-h-0">
      <div class="flex flex-row gap-2 flex-1 min-h-0">
        <WriteModeInput class="flex-1" />
        <div class="flex gap-2 flex-col">
          <Button sm square @click="clear" :title="t('editor.clear')">
            <Icon icon="mdi:clear" height="24" />
          </Button>
        </div>
      </div>
      <p class="text-xs mt-1 text-muted">{{ t('write.escNext') }}</p>
    </div>
  </ContentPadding>
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'

import { useCallAi } from '../composables/useCallAi'
import { useI18n } from '../composables/useI18n'
import useToast from '../composables/useToast'
import { useHistoryStore } from '../stores/history'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'
import { useWriterInputStore } from '../stores/writerInput'
import { Icon } from '@iconify/vue'

const navPanelStore = useNavPanelStore()
const writerInputStore = useWriterInputStore()
const ipcStore = useIpcStore()
const { correctText } = useCallAi()
const menuModalsStore = useMenuModalsStore()
const historyStore = useHistoryStore()
const { toast } = useToast()
const appConfig = ipcStore.params!.appConfig
const correctedText = ref('')
const correctionIsActual = ref(true)
const { t } = useI18n()

navPanelStore.resetNavParams({
  escBtnLabelKey: 'write.next',
  escBtnAction: doCorrection,
  panelVisible: false,
})

watch(
  () => writerInputStore.value,
  () => {
    correctionIsActual.value = false
  }
)

onUnmounted(async () => {
  if (writerInputStore.value) {
    await historyStore.saveEditorHistory(writerInputStore.value)
    writerInputStore.value = ''
  }

  await historyStore.clearMainInputTmp()
})

const clear = () => {
  writerInputStore.clear()
  writerInputStore.focus()
}

async function doCorrection() {
  if (!writerInputStore.value?.trim()) {
    toast(t('write.enterTextForCorrection'), 'warn')
    return
  } else if (correctionIsActual.value) {
    toast(t('write.alreadyCorrected'), 'warn')
  } else if (writerInputStore.value.length < appConfig.minCorrectionLength) {
    toast(t('write.textTooShortForCorrection'), 'warn')

    correctedText.value = writerInputStore.value
    correctionIsActual.value = true
  } else {
    menuModalsStore.setPendingModal({
      correction: true,
    })

    const result = await correctText(writerInputStore.value)

    historyStore.saveTransformHistory(result)

    correctedText.value = result
    correctionIsActual.value = true
  }

  // TODO: текст могут отредактировать в diff ???
  menuModalsStore.nextModal(MenuModals.INSERT, {
    text: correctedText.value,
    oldText: writerInputStore.value,
  })
}
</script>
