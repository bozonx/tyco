<template>
  <div class="flex flex-col gap-4 w-full h-full">
    <h1>{{ t('menu.translate') }}</h1>

    <div class="flex-1 min-h-0">
      <TextPreview :text="props.text" />
    </div>

    <ShortcutList :text="props.text" :leftLetterKeys="leftLetterKeys" />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useCallAi } from '../../composables/useCallAi'
import { useI18n } from '../../composables/useI18n'
import useToast from '../../composables/useToast'
import { getLanguageLabel } from '../../lib/locale/language'
import { type ActionItem } from '../../stores/actionMenu'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menuModals'

const props = withDefaults(defineProps<{ text?: string }>(), { text: '' })

const ipcStore = useIpcStore()
const appConfig = computed(() => ipcStore.params.appConfig)
const { translateText } = useCallAi()
const menuModalsStore = useMenuModalsStore()
const historyStore = useHistoryStore()
const { toast } = useToast()
const { t } = useI18n()
const leftLetterKeys = computed<(ActionItem | undefined)[]>(() =>
  ipcStore.params.userConfig.toTranslateLanguages.map(
    (lang: string | null, index: number) =>
      lang
        ? {
            name: t(getLanguageLabel(lang)),
            action: async () => {
              await translate(index)
            },
          }
        : undefined
  )
)

const translate = async (toLangNum: number) => {
  const trimmedText = props.text.trim()

  if (!trimmedText) {
    toast(t('toast.noTextToTranslate'), 'warn')

    return
  }

  if (trimmedText.length < appConfig.value.minCorrectionLength) {
    toast(t('toast.textTooShortToTranslate'), 'warn')

    return
  }

  const sourceId = await historyStore.saveSource(trimmedText, 'translate')

  menuModalsStore.setPendingModal({ ai: true })

  const newText = await translateText(toLangNum, trimmedText)
  await historyStore.saveSourceResult(sourceId, newText).catch(() => {
    toast(t('history.operationFailed'), 'error')
  })

  menuModalsStore.nextModal(MenuModals.PREVIEW, {
    text: newText,
    sourceText: trimmedText,
  })
}
</script>
