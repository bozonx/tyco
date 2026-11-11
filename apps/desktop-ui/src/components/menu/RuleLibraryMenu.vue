<template>
  <ActionOverlayLayout :title="t(props.kind.titleKey)">
    <template #preview>
      <TextPreview :text="props.text" />
    </template>

    <template #actions>
      <ShortcutList
        :text="props.text"
        :left-letter-keys="leftLetterKeys"
        :shortcuts-disabled="props.shortcutsDisabled"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useMenuStartup } from '../../composables/use-menu-startup'
import { useMenuStepRun } from '../../composables/use-menu-step-run'
import useToast from '../../composables/use-toast'
import type { RuleLibraryMenuKind } from '../../lib/modals/rule-library-menu'
import {
  findSlotItem,
  slotItemLabel,
  slotItemList,
} from '../../lib/shortcut-slots/slot-library'
import type { ActionItem } from '../../stores/action-menu'
import { useDesktopStore } from '../../stores/desktop'
import { useInvocationsStore } from '../../stores/invocations'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import TextPreview from '../common/TextPreview.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ShortcutList from '../overlay/ShortcutList.vue'

/** A menu of the rules of a library: the styles or the transformations */
const props = withDefaults(
  defineProps<{
    kind: RuleLibraryMenuKind
    text?: string
    shortcutsDisabled?: boolean
    /** Runs this rule immediately when the menu opens */
    itemId?: string
  }>(),
  { text: '', shortcutsDisabled: false, itemId: undefined }
)

const menuModalsStore = useMenuModalsStore()
const desktopStore = useDesktopStore()
const invocations = useInvocationsStore()
const { toastKey } = useToast()
const runStep = useMenuStepRun()
const { t } = useI18n()

const library = () => props.kind.getLibrary(desktopStore.userConfig)

const leftLetterKeys = computed<(ActionItem | undefined)[]>(() =>
  slotItemList(library()).map((item) =>
    item?.rule.trim()
      ? { name: slotItemLabel(item), action: () => runItem(item.id) }
      : undefined
  )
)

async function runItem(itemId: string) {
  const item = findSlotItem(library()?.items, itemId)
  if (!item?.rule.trim()) {
    // e.g. removed in the settings while the menu was open
    toastKey('menu.ruleNotFound', 'warn')
    return
  }
  await runRule(item.rule, slotItemLabel(item))
}

useMenuStartup({
  getValue: () => props.itemId,
  consume: () => {
    const stepId = menuModalsStore.currentStepId
    if (stepId !== undefined) props.kind.clearStartupItem(stepId)
  },
  run: runItem,
})

async function runRule(rule: string, itemLabel?: string) {
  const trimmedText = props.text.trim()

  if (!trimmedText) {
    toastKey('toast.noTextToProcess', 'warn')
    return
  }

  if (trimmedText.length < props.kind.minTextLength) {
    toastKey('toast.textTooShortToProcess', 'warn')
    return
  }

  await runStep({
    text: trimmedText,
    sourceText: props.text,
    operation: 'aiTask',
    pending: itemLabel
      ? { ...props.kind.pending, label: itemLabel }
      : props.kind.pending,
    invoke: (signal) =>
      invocations.call(props.kind.toolId, trimmedText, {
        signal,
        toolConfig: { prompt: rule },
      }),
    // an empty result is a failed one: the tool has said so already
    read: (result) => result.content ?? null,
    show: (newText) =>
      menuModalsStore.nextModal(MenuModals.DIFF, {
        oldText: props.text,
        newText,
      }),
  })
}
</script>
