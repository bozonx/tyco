<template>
  <div class="flex flex-col gap-4 w-full h-full">
    <h1>{{ t('menu.translate') }}</h1>

    <div class="flex-1">
      <TextPreview :text="props.text" />
    </div>

    <ShortcutList :text="props.text" :leftLetterKeys="leftLetterKeys" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { type ActionItem } from '../../stores/actionMenu'
import { getLanguageLabel } from '../../lib/locale/language'
import { useIpcStore } from '../../stores/ipc'
import { useCallAi } from '../../composables/useCallAi'
import { MenuModals, useMenuModalsStore } from '../../stores/menuModals'
import useToast from '../../composables/useToast'
import { useHistoryStore } from '../../stores/history'

const props = withDefaults(
  defineProps<{
    text?: string
  }>(),
  {
    text: '',
  }
)

const ipcStore = useIpcStore()
const appConfig = computed(() => ipcStore.params.appConfig)
const { translateText } = useCallAi()
const menuModalsStore = useMenuModalsStore()
const historyStore = useHistoryStore()
const { toast } = useToast()
const { t } = useI18n()
const leftLetterKeys = computed<ActionItem[]>(() =>
  ipcStore.params.userConfig.toTranslateLanguages.map((lang: string, index: number) => ({
    name: t(getLanguageLabel(lang)),
    action: async () => {
      await translate(index)
    },
  }))
)

const translate = async (toLangNum: number) => {
  const trimmedText = props.text.trim()
  
  if (!trimmedText) {
    toast(t('toast.noTextToTranslate'), 'warn');

    return;
  }

  if (trimmedText.length < appConfig.value.minCorrectionLength) {
    toast(t('toast.textTooShortToTranslate'), 'warn');

    return;
  }

  menuModalsStore.setPendingModal({ ai: true })
  
  const newText = await translateText(toLangNum, trimmedText)

  await historyStore.saveTransformHistory(newText)

  menuModalsStore.nextModal(MenuModals.PREVIEW, {
    text: newText,
  })
}
</script>
