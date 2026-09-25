<template>
  <ActionOverlayLayout :title="t('menu.translate')">
    <template #preview>
      <TextPreview :text="props.text" />
    </template>

    <template #actions>
      <ShortcutList
        :text="props.text"
        :leftLetterKeys="leftLetterKeys"
        :toEditorVisible="!routeParamsStore.isEditorPage()"
      />
    </template>
  </ActionOverlayLayout>
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
import { useRouteParams } from '../../stores/routeParams'
import ShortcutList from '../ShortcutList.vue'
import ActionOverlayLayout from '../common/ActionOverlayLayout.vue'
import TextPreview from '../common/TextPreview.vue'

const props = withDefaults(defineProps<{ text?: string }>(), { text: '' })

const ipcStore = useIpcStore()
const routeParamsStore = useRouteParams()
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
  const sourceText = props.text

  if (!sourceText.trim()) {
    toast(t('toast.noTextToTranslate'), 'warn')

    return
  }

  if (sourceText.trim().length < appConfig.value.minCorrectionLength) {
    toast(t('toast.textTooShortToTranslate'), 'warn')

    return
  }

  const sourceId = await historyStore.saveSource(sourceText, 'translate')

  const controller = new AbortController()
  const stageLabels = {
    translating: 'translationProgressTranslating',
    checking: 'translationProgressChecking',
    repairing: 'translationProgressRepairing',
  } as const
  const setStage = (stage: keyof typeof stageLabels) =>
    menuModalsStore.setPendingModal({
      label: t(`menu.${stageLabels[stage]}`),
      onCancel: () => controller.abort(),
    })
  setStage('translating')
  try {
    const result = await translateText(toLangNum, sourceText, {
      signal: controller.signal,
      onStage: setStage,
    })
    if (!result) return
    await historyStore.saveSourceResult(sourceId, result.text).catch(() => {
      toast(t('history.operationFailed'), 'error')
    })
    menuModalsStore.nextModal(MenuModals.PREVIEW, {
      text: result.text,
      sourceText,
      translationMeta: {
        provider: result.provider,
        model: result.model,
        quality: result.quality,
      },
    })
  } catch {
    // The request layer already reported the actionable error.
  } finally {
    menuModalsStore.clearPendingModal()
  }
}
</script>
