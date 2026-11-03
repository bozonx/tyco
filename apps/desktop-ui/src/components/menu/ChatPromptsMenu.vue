<template>
  <ActionOverlayLayout :title="t('menu.chatPrompts')" :on-esc="close">
    <template #preview>
      <TextPreview :text="props.text" />
    </template>

    <template #actions>
      <ShortcutList
        :text="props.text"
        :left-letter-keys="leftLetterKeys"
        :shortcuts-disabled="props.shortcutsDisabled"
        :is-editor-button-visible="!editorNavigation.isEditorPage()"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { useMenuStartup } from '../../composables/use-menu-startup'
import { useOverlayNav } from '../../composables/use-overlay-nav'
import useToast from '../../composables/use-toast'
import type { ChatPromptsMenuParams } from '../../lib/modals/menu-modal-params'
import {
  findSlotItem,
  slotItemLabel,
  slotItemList,
} from '../../lib/shortcut-slots/slot-library'
import type { ActionItem } from '../../stores/action-menu'
import { useDesktopStore } from '../../stores/desktop'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import TextPreview from '../common/TextPreview.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ShortcutList from '../overlay/ShortcutList.vue'

const props = withDefaults(defineProps<ChatPromptsMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
  promptId: undefined,
})

const editorNavigation = useEditorNavigation()
const menuModalsStore = useMenuModalsStore()
const desktopStore = useDesktopStore()
const ipcStore = useIpcStore()
const { toastKey } = useToast()
const { t } = useI18n()
const { handleEsc } = useOverlayNav()

const library = () => desktopStore.userConfig.chatPrompts

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() =>
  slotItemList(library()).map((item) =>
    item?.rule.trim()
      ? { name: slotItemLabel(item), action: () => runPrompt(item.rule) }
      : undefined
  )
)

function close() {
  handleEsc()
}

async function runPrompt(promptText: string) {
  const trimmedPrompt = promptText.trim()
  if (!trimmedPrompt) return

  menuModalsStore.closeAll()

  const trimmedText = props.text?.trim()

  await ipcStore.callOrNotify('open_main_chat', {
    attachment: trimmedText ? { text: trimmedText } : undefined,
    question: trimmedPrompt,
    autoSend: true,
  })
}

async function runItem(itemId: string) {
  const item = findSlotItem(library()?.items, itemId)
  if (!item?.rule.trim()) {
    toastKey('menu.ruleNotFound', 'warn')
    return
  }
  await runPrompt(item.rule)
}

useMenuStartup({
  getValue: () => props.promptId,
  consume: () => {
    const stepId = menuModalsStore.currentStepId
    if (stepId !== undefined) {
      menuModalsStore.updateStep(stepId, MenuModals.CHAT_PROMPTS, {
        promptId: undefined,
      })
    }
  },
  run: runItem,
})
</script>
