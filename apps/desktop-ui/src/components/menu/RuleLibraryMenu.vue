<template>
  <ActionOverlayLayout
    :title="t(props.kind.titleKey)"
    :on-esc="isPromptMode ? closePromptMode : undefined"
  >
    <template #preview>
      <TextPreview :text="props.text" />
    </template>

    <template #actions>
      <QueryPanel
        v-if="isPromptMode"
        :disabled="
          props.shortcutsDisabled || Boolean(menuModalsStore.pendingModal)
        "
        v-model="prompt"
        :placeholder="t('menu.aiPromptPlaceholder')"
        :options="recentOptions"
        :hints="promptHints"
        @submit="submitPrompt"
        @save="savePrompt"
        @back="closePromptMode"
      />
      <ShortcutList
        v-else
        :text="props.text"
        :space-key="customPromptAction"
        :left-letter-keys="leftLetterKeys"
        :shortcuts-disabled="props.shortcutsDisabled"
        :is-editor-button-visible="!editorNavigation.isEditorPage()"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { useMenuStartup } from '../../composables/use-menu-startup'
import { useMenuStepRun } from '../../composables/use-menu-step-run'
import useToast from '../../composables/use-toast'
import { isQuickWindow as isInQuickWindow } from '../../lib/desktop/window'
import { describeError } from '../../lib/errors/describe-error'
import { filterOptions, pushRecent } from '../../lib/menu-query/menu-query'
import {
  type RuleLibraryMenuKind,
  SAVE_PROMPT_MESSAGES,
} from '../../lib/modals/rule-library-menu'
import {
  findSlotItem,
  slotItemLabel,
  slotItemList,
} from '../../lib/shortcut-slots/slot-library'
import { type ActionItem } from '../../stores/action-menu'
import { useChatStore } from '../../stores/chat'
import { useChatInputStore } from '../../stores/chat-input'
import { useDesktopStore } from '../../stores/desktop'
import { useInvocationsStore } from '../../stores/invocations'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import TextPreview from '../common/TextPreview.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ShortcutList from '../overlay/ShortcutList.vue'
import QueryPanel, {
  type QueryPanelHint,
  type QueryPanelOption,
  type QueryPanelSubmit,
} from './QueryPanel.vue'

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

const editorNavigation = useEditorNavigation()
const menuModalsStore = useMenuModalsStore()
const desktopStore = useDesktopStore()
const invocations = useInvocationsStore()
const { toastKey, toastText } = useToast()
const runStep = useMenuStepRun()
const { t } = useI18n()
const chatStore = useChatStore()
const chatInputStore = useChatInputStore()

/** The own request mode: an input instead of the rule keys */
const isPromptMode = ref(false)
const prompt = ref('')

const isQuickWindow = isInQuickWindow()

const library = () => props.kind.getLibrary(desktopStore.userConfig)

const customPromptAction: ActionItem = {
  labelKey: 'menu.aiCustomPrompt',
  icon: 'mdi:pencil-outline',
  action: async () => {
    prompt.value = ''
    isPromptMode.value = true
  },
}

const closePromptMode = () => {
  isPromptMode.value = false
}

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
  await runRule(item.rule)
}

useMenuStartup({
  getValue: () => props.itemId,
  consume: () => {
    const stepId = menuModalsStore.currentStepId
    if (stepId !== undefined) props.kind.clearStartupItem(stepId)
  },
  run: runItem,
})

const recentPrompts = computed(
  () => desktopStore.sessionState?.recentAiPrompts ?? []
)

const recentOptions = computed<QueryPanelOption[]>(() =>
  filterOptions(
    recentPrompts.value.map((entry) => ({ id: entry, label: entry })),
    prompt.value
  ).filter((option) => option.label !== prompt.value.trim())
)

const canAskInChat = () =>
  !isQuickWindow && desktopStore.userConfig.isInDevelopment

const promptHints = computed<QueryPanelHint[]>(() => [
  {
    keys: ['Enter'],
    label: t('menu.aiPromptRun'),
    disabled: !prompt.value.trim(),
    action: () => submitPrompt({ ctrl: false }),
  },
  ...(canAskInChat()
    ? [
        {
          keys: ['Ctrl', 'Enter'],
          label: t('action.askInChat'),
          disabled: !prompt.value.trim(),
          action: () => submitPrompt({ ctrl: true }),
        },
      ]
    : []),
  {
    keys: ['Ctrl', 'S'],
    label: t('menu.aiPromptSave'),
    disabled: !prompt.value.trim(),
    action: savePrompt,
  },
  { keys: ['Esc'], label: t('common.back'), action: closePromptMode },
])

const rememberPrompt = (value: string) => {
  void desktopStore.patchSessionState({
    recentAiPrompts: pushRecent(recentPrompts.value, value),
  })
}

async function submitPrompt({ option, ctrl }: QueryPanelSubmit) {
  const value = (option?.label ?? prompt.value).trim()
  if (!value) return

  rememberPrompt(value)

  if (ctrl && canAskInChat()) {
    menuModalsStore.closeAll()
    try {
      await chatStore.attachToChat(props.text)
      chatInputStore.setValue(value)
      await chatStore.sendInput()
    } catch (error) {
      toastText(describeError(error, t), 'error')
    }
    return
  }

  await runRule(value)
}

async function savePrompt() {
  const value = prompt.value.trim()
  const current = library()
  if (!value || !current) return

  const saved = props.kind.savePrompt(current, value)
  if (!saved) return
  const message = SAVE_PROMPT_MESSAGES[saved.outcome]
  if (saved.outcome === 'added' || saved.outcome === 'placed') {
    const result = await desktopStore.updateUserConfig(
      props.kind.patchLibrary(saved.library)
    )
    if (!result.success) {
      toastKey('toast.desktopCommandFailed', 'error')
      return
    }
  }
  toastKey(message.key, message.level)
}

async function runRule(rule: string) {
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
    pending: props.kind.pending,
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
