<template>
  <ActionOverlayLayout
    :title="t('action.customTransformation')"
    :on-esc="close"
  >
    <template #preview>
      <TextPreview :text="props.text" />
    </template>

    <template #actions>
      <QueryPanel
        v-model="prompt"
        :disabled="
          props.shortcutsDisabled || Boolean(menuModalsStore.pendingModal)
        "
        :placeholder="t('menu.aiPromptPlaceholder')"
        :options="recentOptions"
        :hints="promptHints"
        @submit="submitPrompt"
        @back="close"
      />
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useMenuStepRun } from '../../composables/use-menu-step-run'
import useToast from '../../composables/use-toast'
import { isQuickWindow as isInQuickWindow } from '../../lib/desktop/window'
import { describeError } from '../../lib/errors/describe-error'
import { filterOptions, pushRecent } from '../../lib/menu-query/menu-query'
import type { CustomTransformationMenuParams } from '../../lib/modals/menu-modal-params'
import { useChatStore } from '../../stores/chat'
import { useChatInputStore } from '../../stores/chat-input'
import { useDesktopStore } from '../../stores/desktop'
import { useInvocationsStore } from '../../stores/invocations'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import { useWindowStore } from '../../stores/window'
import TextPreview from '../common/TextPreview.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import QueryPanel, {
  type QueryPanelHint,
  type QueryPanelOption,
  type QueryPanelSubmit,
} from './QueryPanel.vue'
import { APP_CONFIG } from '@tyco/shared'

const props = withDefaults(defineProps<CustomTransformationMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
})

const menuModalsStore = useMenuModalsStore()
const desktopStore = useDesktopStore()
const invocations = useInvocationsStore()
const windowStore = useWindowStore()
const { toastKey, toastText } = useToast()
const runStep = useMenuStepRun()
const { t } = useI18n()
const chatStore = useChatStore()
const chatInputStore = useChatInputStore()

const prompt = ref('')
const isQuickWindow = isInQuickWindow()

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
  { keys: ['Esc'], label: t('common.back'), action: close },
])

const rememberPrompt = (value: string) => {
  void desktopStore.patchSessionState({
    recentAiPrompts: pushRecent(recentPrompts.value, value),
  })
}

function close() {
  if (isQuickWindow) {
    void windowStore.hide()
  } else {
    menuModalsStore.closeAll()
  }
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

  const trimmedText = props.text.trim()

  if (!trimmedText) {
    toastKey('toast.noTextToProcess', 'warn')
    return
  }

  if (trimmedText.length < APP_CONFIG.minTransformationLength) {
    toastKey('toast.textTooShortToProcess', 'warn')
    return
  }

  await runStep({
    text: trimmedText,
    sourceText: props.text,
    operation: 'aiTask',
    pending: { transformation: true },
    invoke: (signal) =>
      invocations.call('core.transformation', trimmedText, {
        signal,
        toolConfig: { prompt: value },
      }),
    read: (result) => result.content ?? null,
    show: (newText) =>
      menuModalsStore.nextModal(MenuModals.DIFF, {
        oldText: props.text,
        newText,
      }),
  })
}
</script>
