<template>
  <ActionOverlayLayout
    :title="t('menu.transformation')"
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
        @save="savePromptAsTransformation"
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
import { filterOptions, pushRecent } from '../../lib/menu-query/menu-query'
import type { TransformationMenuParams } from '../../lib/modals/menu-modal-params'
import {
  findTransformation,
  transformationSlotList,
} from '../../lib/transformations/transformation-library'
import { addTransformationFromPrompt } from '../../lib/transformations/transformation-prompt'
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
import { APP_CONFIG } from '@tyco/shared'

const props = withDefaults(defineProps<TransformationMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
  transformationId: undefined,
})

const editorNavigation = useEditorNavigation()
const menuModalsStore = useMenuModalsStore()
const desktopStore = useDesktopStore()
const invocations = useInvocationsStore()
const { toastKey } = useToast()
const runStep = useMenuStepRun()
const { t } = useI18n()
const chatStore = useChatStore()
const chatInputStore = useChatInputStore()

/** The own request mode: an input instead of the transformation keys */
const isPromptMode = ref(false)
const prompt = ref('')

const isQuickWindow = isInQuickWindow()

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
  transformationSlotList(desktopStore.userConfig?.transformations).map(
    (item) =>
      item && item.name
        ? { name: item.name, action: () => runTransformation(item.id) }
        : undefined
  )
)

async function runTransformation(transformationId: string) {
  const item = findTransformation(
    desktopStore.userConfig?.transformations.items,
    transformationId
  )
  if (!item || !item.rule?.trim()) {
    toastKey('toast.desktopCommandFailed', 'error')
    return
  }
  await makeDiff(item.rule)
}

useMenuStartup({
  getValue: () => props.transformationId,
  consume: () => {
    const stepId = menuModalsStore.currentStepId
    if (stepId !== undefined) {
      menuModalsStore.updateStep(stepId, MenuModals.TRANSFORMATION, {
        transformationId: undefined,
      })
    }
  },
  run: runTransformation,
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

const promptHints = computed<QueryPanelHint[]>(() => [
  {
    keys: ['Enter'],
    label: t('menu.aiPromptRun'),
    disabled: !prompt.value.trim(),
    action: () => submitPrompt({ ctrl: false }),
  },
  ...(isQuickWindow || !desktopStore.userConfig.isInDevelopment
    ? []
    : [
        {
          keys: ['Ctrl', 'Enter'],
          label: t('action.askInChat'),
          disabled: !prompt.value.trim(),
          action: () => submitPrompt({ ctrl: true }),
        },
      ]),
  {
    keys: ['Ctrl', 'S'],
    label: t('menu.aiPromptSave'),
    disabled: !prompt.value.trim(),
    action: savePromptAsTransformation,
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

  if (ctrl && !isQuickWindow && desktopStore.userConfig.isInDevelopment) {
    menuModalsStore.closeAll()
    await chatStore.attachToChat(props.text)
    chatInputStore.setValue(value)
    await chatStore.sendInput()
    return
  }

  await makeDiff(value)
}

async function savePromptAsTransformation() {
  const value = prompt.value.trim()
  const userConfig = desktopStore.userConfig
  if (!value || !userConfig) return

  const library = addTransformationFromPrompt(userConfig.transformations, value)
  if (!library) {
    toastKey('menu.aiPromptSlotsFull', 'warn')
    return
  }

  const result = await desktopStore.updateUserConfig({
    transformations: library,
  })
  if (!result.success) toastKey('toast.desktopCommandFailed', 'error')
}

async function makeDiff(prompt: string) {
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
    operation: 'aiTask',
    pending: { transformation: true },
    invoke: (signal) =>
      invocations.call('core.transformation', trimmedText, {
        signal,
        toolConfig: { prompt },
      }),
    read: (result) => {
      const newText = result.content ?? ''
      if (newText.trim()) return newText
      toastKey('toast.desktopCommandFailed', 'error')
      return null
    },
    show: (newText) =>
      menuModalsStore.nextModal(MenuModals.DIFF, {
        oldText: props.text,
        newText,
      }),
  })
}
</script>
