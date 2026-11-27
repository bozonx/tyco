<template>
  <Button
    size="sm"
    variant="ghost"
    icon="mdi:broom"
    :loading="isClearing"
    :disabled="count === 0"
    @click="isConfirmOpen = true"
  >
    {{
      count === 0
        ? t('history.clear')
        : t(pluralKey(labelKeys, count, locale), { count })
    }}
  </Button>
  <ConfirmModal
    :open="isConfirmOpen"
    :title="confirmTitle"
    :message="confirmMessage"
    :confirm-text="t('history.clearConfirmButton')"
    danger
    @confirm="clearHistory"
    @cancel="isConfirmOpen = false"
  />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useBusyAction } from '../../composables/use-busy-action'
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { type PluralKeys, pluralKey } from '../../lib/i18n/plural'
import { toHtmlLang } from '../../lib/locale/language'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'

/**
 * The delete button in the header of a history section, naming how much it
 * deletes. Clearing is the only way the settings delete a history: no setting
 * does, see `applyHistoryKeeping`
 */
const props = defineProps<{
  count: number
  /** "Delete all {count} …", by plural form */
  labelKeys: PluralKeys
  confirmTitle: string
  confirmMessage: string
  clear: () => Promise<unknown>
}>()
const { t } = useI18n()
const { effectiveAppLanguage } = useSettingsContext()
const locale = computed(() => toHtmlLang(effectiveAppLanguage.value))
const { toastKey } = useToast()
const { isBusy: isClearing, run } = useBusyAction(() =>
  toastKey('history.operationFailed', 'error')
)
const isConfirmOpen = ref(false)
async function clearHistory() {
  if (isClearing.value) return
  isConfirmOpen.value = false
  await run(async () => {
    await props.clear()
    toastKey('history.cleared', 'info')
  })
}
</script>
