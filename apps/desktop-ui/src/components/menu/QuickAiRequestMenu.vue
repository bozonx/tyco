<template>
  <ActionOverlayLayout
    :title="t('action.quickAiRequest')"
    :on-esc="handleEsc"
    :esc-mode="canReturnToPrevious ? 'back' : 'close'"
  >
    <template #header-actions>
      <Button
        v-if="canOpenSelectionActions"
        variant="ghost"
        size="sm"
        :disabled="isInputBlocked || model.isGenerating.value || isApplying"
        @click="openSelectionActions"
        >{{ t('menu.otherActions') }}</Button
      >
    </template>
    <template #preview>
      <ContextPreview
        v-if="props.text"
        :text="props.text"
        :disabled="model.isSourceTextDisabled.value"
        :allow-disable="!model.isSourceTextLocked.value"
        @update:disabled="(disabled) => model.setSourceTextDisabled(disabled)"
      />
      <div
        v-if="props.screenshotMode"
        class="screenshot-preview"
        :class="{ 'is-with-turns': model.turns.value.length > 0 }"
      >
        <ChatImageAttachment
          v-for="img in model.sourceImages.value"
          :key="img.id"
          :image="img"
          :removable="!model.isSourceImageLocked.value && !isCapturing"
          size="large"
          @remove="requestRemoveScreenshot(img.id)"
        />
        <button
          type="button"
          class="add-screenshot-btn"
          :aria-label="t('screenshot.addArea')"
          :title="t('screenshot.addArea')"
          :disabled="isCapturing || model.isSourceImageLocked.value"
          @click="addScreenshot"
        >
          <AppIcon icon="mdi:selection-drag" size="lg" aria-hidden="true" />
          <span class="add-screenshot-label">{{
            t('screenshot.addArea')
          }}</span>
        </button>
      </div>

      <ConfirmModal
        :open="Boolean(screenshotToDelete)"
        :title="t('screenshot.deleteConfirmTitle')"
        :message="t('screenshot.deleteConfirmMessage')"
        :confirm-text="t('common.delete')"
        danger
        @confirm="confirmRemoveScreenshot"
        @cancel="cancelRemoveScreenshot"
      />

      <QuickAiRequestTurns
        :turns="model.turns.value"
        :source-text="model.sourceText.value"
        :pending-approvals="runtime.pendingApprovals.value"
        @apply-reply-block="(block, target) => applyReply(block, target)"
        @answer-tool-approval="
          (approvalId, decision) =>
            model.answerToolApproval(approvalId, decision)
        "
      />

      <!-- Model problems are told at once; request errors after a send -->
      <div v-if="bannerText" class="quick-error-banner" role="alert">
        <AppIcon icon="mdi:alert-circle-outline" size="md" />
        <span class="quick-error-text">{{ bannerText }}</span>
        <button type="button" class="quick-error-link" @click="goToSettings">
          {{ t('chat.configureModels') }}
        </button>
      </div>
    </template>

    <template #actions>
      <VoiceRecognitionMenu
        v-if="isListening"
        variant="bar"
        chat
        :show-cancel-button="false"
        cancel-shortcut
        target="chat"
        finish-behavior="prompt"
        allow-empty-input
        keep-error-visible
        :activation-mode="voiceActivationMode"
        :prefix="voiceRange.prefix"
        :suffix="voiceRange.suffix"
        @cancelled="handleVoiceCancelled"
        @corrected="handleVoiceCorrected"
      />
      <div
        v-else-if="isResultVisible"
        ref="resultActionsRef"
        class="quick-result-actions"
        tabindex="-1"
      >
        <FieldSelect
          v-if="model.replyBlocks.value.length > 1"
          :aria-label="t('quickAiRequest.chooseVariant')"
          :model-value="model.selectedReplyBlockIndex.value"
          :options="replyOptions"
          :disabled="isInputBlocked || isApplying"
          @update:model-value="(index) => model.selectReplyBlock(Number(index))"
        />
        <ShortcutButton
          v-if="
            model.selectedReplyBlock.value && !editorNavigation.isEditorPage()
          "
          :keys="[]"
          :disabled="isInputBlocked || isApplying"
          @click="
            editorNavigation.toEditor(
              model.selectedReplyBlock.value!.text,
              model.sourceText.value || undefined
            )
          "
          >{{ t('shortcuts.insertIntoEditor') }}</ShortcutButton
        >
        <ShortcutButton
          :keys="[]"
          variant="ghost"
          :disabled="isInputBlocked || isApplying"
          @click="switchToChat"
        >
          {{ t('quickAiRequest.goToChat') }}
        </ShortcutButton>
        <ShortcutButton
          :keys="[]"
          variant="ghost"
          :disabled="isInputBlocked || isApplying"
          @click="openFollowUp"
        >
          {{ t('quickAiRequest.followUp') }}
        </ShortcutButton>
        <ShortcutButton
          :keys="['Shift', 'Space']"
          v-if="resultActionText"
          class="quick-next-action"
          variant="ghost"
          :disabled="!resultActionText || isInputBlocked || isApplying"
          @click="openNextStep"
        >
          {{ t('menu.actions') }}
        </ShortcutButton>
        <ShortcutButton
          v-if="model.replyBlocks.value.length"
          class="quick-insert-action"
          variant="primary"
          :keys="['Enter', 'Space']"
          :disabled="
            !model.selectedReplyBlock.value || isInputBlocked || isApplying
          "
          @click="insertSelectedReply"
        >
          {{ t('replyBlocks.insertIntoWindow') }}
        </ShortcutButton>
      </div>
      <QueryPanel
        v-else
        ref="queryPanelRef"
        v-model="input.value.value"
        multiline
        :submit-key="
          resolveSubmitKey(desktopStore.userConfig?.editor?.submitKey)
        "
        :disabled="isInputBlocked || model.isGenerating.value"
        :placeholder="promptPlaceholder"
        :options="recentOptions"
        options-placement="above-popover"
        @blur="handleInputBlur"
        @submit="handleQuerySubmit"
        @back="handleEsc"
      >
        <template #after-input>
          <DropdownMenu
            v-if="recentPrompts.length > 0"
            square
            hide-chevron
            size="md"
            variant="ghost"
            placement="top"
            align="right"
            icon="mdi:history"
            class="recent-prompts-menu"
            :label="t('quickAiRequest.recentPrompts')"
            :title="t('quickAiRequest.recentPrompts')"
            :disabled="isInputBlocked || model.isGenerating.value"
            :items="recentMenuItems"
            @open-change="isRecentMenuOpen = $event"
          />
          <IconButton
            icon="mdi:microphone-outline"
            size="md"
            variant="ghost"
            class="mic-action-btn"
            :disabled="isInputBlocked || model.isGenerating.value"
            :label="t('chat.voiceInput')"
            :title="t('chat.voiceInput')"
            @click="startVoice"
          />
        </template>
        <template #footer-start>
          <QuickAiModelBar
            :profile-id="model.profileId.value"
            :model-id="model.modelId.value"
            :models="model.modelOptions.value"
            :is-profile-locked="model.isProfileLocked.value"
            :is-model-disabled="model.isGenerating.value"
            @update:profile-id="model.setProfileId"
            @update:model-id="(id) => void model.setModelId(id)"
          />
          <Button
            variant="ghost"
            size="sm"
            icon="mdi:chat-question-outline"
            :disabled="isInputBlocked"
            @click="switchToChat"
          >
            {{ t('quickAiRequest.goToChat') }}
          </Button>
        </template>
        <template #footer-end>
          <ShortcutButton
            v-if="!model.isGenerating.value"
            variant="primary"
            size="sm"
            class="run-action-btn"
            :keys="[
              resolveSubmitKey(desktopStore.userConfig?.editor?.submitKey),
            ]"
            :disabled="!canSend"
            @click="handleQuerySubmit({ ctrl: false })"
          >
            {{ t('menu.aiPromptRun') }}
          </ShortcutButton>
        </template>
      </QueryPanel>
    </template>
  </ActionOverlayLayout>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useEditorNavigation } from '../../composables/use-editor-navigation'
import { useI18n } from '../../composables/use-i18n'
import { useOverlayNav } from '../../composables/use-overlay-nav'
import useToast from '../../composables/use-toast'
import { getChatImage } from '../../lib/chat/chat-image-storage'
import { createChatInputModel } from '../../lib/chat/chat-input-model'
import { invokeDesktop } from '../../lib/desktop/invoke'
import { isQuickWindow as isInQuickWindow } from '../../lib/desktop/window'
import { describeError } from '../../lib/errors/describe-error'
import { resolveSubmitKey } from '../../lib/input-keys/input-keys'
import { clientLogger } from '../../lib/logger'
import type { QuickAiRequestMenuParams } from '../../lib/modals/menu-modal-params'
import { createQuickAiRequestRuntime } from '../../lib/quick-ai-request/quick-ai-request-runtime'
import type { VoiceFinishIntent } from '../../lib/stt/voice-finish-intent'
import { useActionMenuStore } from '../../stores/action-menu'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import { useDesktopStore } from '../../stores/desktop'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { useLlmStore } from '../../stores/llm'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import { useSecretsStore } from '../../stores/secrets'
import { useToolsStore } from '../../stores/tools'
import ChatImageAttachment from '../chat/ChatImageAttachment.vue'
import AppIcon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import DropdownMenu, { type DropdownMenuItem } from '../common/DropdownMenu.vue'
import FieldSelect from '../common/FieldSelect.vue'
import IconButton from '../common/IconButton.vue'
import ActionOverlayLayout from '../overlay/ActionOverlayLayout.vue'
import ContextPreview from '../overlay/ContextPreview.vue'
import ShortcutButton from '../overlay/ShortcutButton.vue'
import QueryPanel, {
  type QueryPanelOption,
  type QueryPanelSubmit,
} from './QueryPanel.vue'
import QuickAiModelBar from './QuickAiModelBar.vue'
import QuickAiRequestTurns from './QuickAiRequestTurns.vue'
import VoiceRecognitionMenu from './VoiceRecognitionMenu.vue'

const props = withDefaults(defineProps<QuickAiRequestMenuParams>(), {
  text: '',
  shortcutsDisabled: false,
  inputMode: 'text',
  profileId: null,
  prompt: '',
  isPromptSent: false,
})

const actionMenuStore = useActionMenuStore()
const menuModalsStore = useMenuModalsStore()
const desktopStore = useDesktopStore()
const historyStore = useHistoryStore()
const ipcStore = useIpcStore()
const llmStore = useLlmStore()
const toolsStore = useToolsStore()
const aiProfilesStore = useAiProfilesStore()
const secretsStore = useSecretsStore()
const editorNavigation = useEditorNavigation()
const { toastKey, toastText } = useToast()
const { t } = useI18n()
const { handleEsc: defaultHandleEsc } = useOverlayNav(() => ({
  escMode: canReturnToPrevious.value ? 'back' : 'close',
}))

const isQuickWindow = isInQuickWindow()
/** The prompt and its caret, kept as the main chat keeps its input */
const input = createChatInputModel()
input.setValue(props.draftPrompt ?? props.prompt)
const navigationStepId = menuModalsStore.currentStepId
const isCapturing = ref(false)
const screenshotToDelete = ref<string | null>(null)
const queryPanelRef = ref<InstanceType<typeof QueryPanel>>()
let disposed = false
const isListening = ref(props.inputMode === 'voice')
/**
 * Overlay-opened voice cancels the overlay; mic-opened voice returns to the
 * prompt input
 */
const voiceEntrySource = ref<'overlay' | 'input'>(
  props.inputMode === 'voice' ? 'overlay' : 'input'
)
const lastInputKind = ref<'text' | 'voice'>(
  props.inputMode === 'voice' ? 'voice' : 'text'
)
/** What stays around the dictated text in the live preview */
const voiceRange = ref({ prefix: '', suffix: '' })

const voiceActivationMode = computed(() => {
  if (!isQuickWindow) return undefined
  const mode = desktopStore.desktopState?.mode
  if (
    mode === 'voiceQuickAiRequest' ||
    mode === 'voiceScreenshotQuickAiRequest'
  ) {
    return mode
  }
  return undefined
})

const runtime = createQuickAiRequestRuntime({
  context: props.screenshotMode
    ? { kind: 'screenshot', images: props.screenshots }
    : { kind: 'selection', text: props.text },
  initialInputMode: props.inputMode,
  initialProfileId: props.profileId,
  invoke: invokeDesktop,
  call: ipcStore.call,
  callOrNotify: ipcStore.callOrNotify,
  llmActions: llmStore.actions,
  loadImage: (id) => getChatImage(id),
  getUserConfig: () => desktopStore.userConfig,
  updateUserConfig: (patch) => desktopStore.updateUserConfig(patch),
  getSecrets: () => secretsStore.secrets,
  getProfile: (id) => aiProfilesStore.getProfile(id),
  updateProfile: (id, patch) => aiProfilesStore.updateProfile(id, patch),
  refreshProfile: (id) => aiProfilesStore.refreshProfile(id),
  readSoul: (id) => aiProfilesStore.readSoul(id),
  readMemory: (id, file) => aiProfilesStore.readMemory(id, file),
  listMemoryTopics: (id) => aiProfilesStore.listMemoryTopics(id),
  tools: toolsStore,
  environment: toolsStore.environment,
  saveOutput: (text) => void historyStore.saveOutput(text, 'quickAiRequest'),
  toEditor: (text, sourceText) => editorNavigation.toEditor(text, sourceText),
  closeOverlay: () => menuModalsStore.closeAll(),
  translate: t,
  toastError: (message) => toastText(message, 'error'),
  warn: (message, scope) => clientLogger.warn(message, scope),
  createId: () => crypto.randomUUID(),
})
const { model } = runtime
if (props.draftMessages) model.restoreNavigationMessages(props.draftMessages)
const replyOptions = computed(() => [
  { id: -1, name: t('quickAiRequest.chooseVariant'), disabled: true },
  ...model.replyBlocks.value.map((block, index) => ({
    id: index,
    name: block.title || block.text.slice(0, 80),
  })),
])
const isFollowUpOpen = ref(false)
const isApplying = ref(false)
const resultActionsRef = ref<HTMLElement>()
const isResultVisible = computed(
  () => model.turns.value.at(-1)?.status === 'done' && !isFollowUpOpen.value
)
watch(isResultVisible, (visible) => {
  if (visible) void nextTick(() => resultActionsRef.value?.focus())
})

function openFollowUp() {
  isFollowUpOpen.value = true
  focusPrompt()
}

async function applyReply(
  block: { text: string; title?: string },
  target: 'window' | 'editor'
) {
  if (isApplying.value || isInputBlocked.value) return
  isApplying.value = true
  try {
    await model.applyReplyBlock(block, target)
  } catch (error) {
    toastText(describeError(error, t), 'error')
  } finally {
    isApplying.value = false
  }
}

async function insertSelectedReply() {
  const block = model.selectedReplyBlock.value
  if (
    !isResultVisible.value ||
    !block ||
    isInputBlocked.value ||
    isApplying.value
  )
    return
  isApplying.value = true
  try {
    await model.applyReplyBlock(block, 'window')
  } catch (error) {
    toastText(describeError(error, t), 'error')
  } finally {
    isApplying.value = false
  }
}

const resultActionText = computed(
  () =>
    model.selectedReplyBlock.value?.text ??
    (model.replyBlocks.value.length
      ? ''
      : (model.turns.value.at(-1)?.answer?.content ?? ''))
)

const canReturnToPrevious = computed(
  () => menuModalsStore.menuBreadcrumbs.length > 1
)
const canOpenSelectionActions = computed(
  () =>
    !canReturnToPrevious.value &&
    Boolean(props.text.trim()) &&
    !isResultVisible.value
)
function openSelectionActions() {
  if (
    !canOpenSelectionActions.value ||
    isInputBlocked.value ||
    model.isGenerating.value ||
    isApplying.value
  )
    return
  const text = props.text
  menuModalsStore.cancelAndCloseAll()
  menuModalsStore.nextModal(MenuModals.INSERT, { text })
}

function openNextStep() {
  if (
    !isResultVisible.value ||
    !resultActionText.value ||
    isInputBlocked.value ||
    isApplying.value
  )
    return
  menuModalsStore.nextModal(MenuModals.INSERT, {
    text: resultActionText.value,
    oldText: model.sourceText.value || undefined,
    escMode: 'back',
  })
}

/** Tells what this request is about: the screenshot, the selection or nothing */
const promptPlaceholder = computed(() => {
  if (model.turns.value.length > 0)
    return t('quickAiRequest.placeholder.followUp')
  if (props.screenshotMode) return t('quickAiRequest.placeholder.screenshot')
  if (model.sourceText.value) return t('quickAiRequest.placeholder.selection')
  return t('quickAiRequest.placeholder.empty')
})

/** Shown at once: the user learns before asking that the model will not do */
const modelIssueText = computed(() =>
  model.modelIssue.value ? model.describeModelIssue(model.modelIssue.value) : ''
)

/** A failed turn shows its error itself, under the question */
const bannerText = computed(
  () =>
    modelIssueText.value ||
    (model.turns.value.at(-1)?.status === 'error' ? '' : model.error.value)
)

// the activation keeps the list: screenshots added or removed show up here
watch(
  () => props.screenshots,
  (images) => {
    if (images) model.setSourceImages(images)
  }
)

watch(
  () => model.isSourceImageLocked.value,
  (locked) => {
    if (locked) screenshotToDelete.value = null
  }
)

function requestRemoveScreenshot(imageId: string) {
  if (model.isSourceImageLocked.value || isCapturing.value) return
  screenshotToDelete.value = imageId
}

function cancelRemoveScreenshot() {
  screenshotToDelete.value = null
}

async function confirmRemoveScreenshot() {
  const imageId = screenshotToDelete.value
  screenshotToDelete.value = null
  if (!imageId) return
  await removeScreenshot(imageId)
}

async function removeScreenshot(imageId: string) {
  if (model.isSourceImageLocked.value) return
  const result = await ipcStore.callOrNotify('remove_screenshot', { imageId })
  if (result.success) model.removeSourceImage(imageId)
}

async function addScreenshot() {
  if (isCapturing.value || model.isSourceImageLocked.value) return
  isCapturing.value = true
  try {
    voiceEntrySource.value = 'input'
    isListening.value = false
    const result = await ipcStore.call('add_screenshot')
    if (disposed) return
    if (result.success) {
      if (result.result) model.addSourceImage(result.result)
    } else toastKey('screenshot.failed', 'error')
  } finally {
    isCapturing.value = false
    await nextTick()
    if (!disposed) queryPanelRef.value?.focus()
  }
}

/** The prompt cannot be edited or sent, the stop button stays live */
const isInputBlocked = computed(
  () =>
    isCapturing.value ||
    props.shortcutsDisabled ||
    Boolean(menuModalsStore.pendingModal)
)

const canSend = computed(
  () =>
    Boolean(input.value.value.trim()) &&
    !isInputBlocked.value &&
    !model.isGenerating.value
)

const RECENT_PROMPTS_INLINE_LIMIT = 5
const RECENT_PROMPTS_MENU_LIMIT = 15

// Query options suggestions filtered by profile
const recentPrompts = ref<string[]>([])
const isRecentMenuOpen = ref(false)
let recentGeneration = 0
async function loadRecentPrompts(pId: string | null) {
  const run = ++recentGeneration
  recentPrompts.value = []
  const res = await ipcStore.call('list_recent_quick_request_prompts', {
    profileId: pId ?? null,
    limit: RECENT_PROMPTS_MENU_LIMIT,
  })
  if (disposed || run !== recentGeneration) return
  recentPrompts.value =
    res.success && Array.isArray(res.result) ? res.result : []
}

watch(
  () => model.profileId.value,
  (pId) => {
    void loadRecentPrompts(pId)
  },
  { immediate: true }
)

/** Auto-suggested only before the first request, when the input is empty */
const recentOptions = computed<QueryPanelOption[]>(() =>
  input.value.value || model.turns.value.length > 0 || isRecentMenuOpen.value
    ? []
    : [...recentPrompts.value.slice(0, RECENT_PROMPTS_INLINE_LIMIT)]
        .reverse()
        .map((entry) => ({ id: entry, label: entry, icon: 'mdi:history' }))
)

const recentMenuItems = computed<DropdownMenuItem[]>(() =>
  recentPrompts.value.map((entry) => ({
    label: entry,
    icon: 'mdi:history',
    action: () => applyRecentPrompt(entry),
  }))
)

function applyRecentPrompt(picked: string) {
  input.setValue(picked)
  lastInputKind.value = 'text'
  void nextTick(() => {
    if (disposed) return
    queryPanelRef.value?.focus()
    queryPanelRef.value?.select(picked.length, picked.length)
  })
}

function handleInputBlur(event: FocusEvent) {
  const element = event.target as HTMLInputElement | HTMLTextAreaElement | null
  if (!element) return
  const length = input.value.value.length
  input.rememberSelection({
    start: element.selectionStart ?? length,
    end: element.selectionEnd ?? length,
  })
}

function startVoice() {
  if (
    isListening.value ||
    isCapturing.value ||
    model.isGenerating.value ||
    disposed
  )
    return
  const live = queryPanelRef.value?.getSelection()
  if (live) input.rememberSelection(live)
  const value = input.value.value
  const range = input.selection.value
  voiceRange.value = {
    prefix: range ? value.slice(0, range.start) : value,
    suffix: range ? value.slice(range.end) : '',
  }
  voiceEntrySource.value = 'input'
  isListening.value = true
}

function focusPrompt() {
  void nextTick(() => {
    if (disposed) return
    queryPanelRef.value?.focus()
    const caret = input.takePendingCaret()
    if (caret !== null) queryPanelRef.value?.select(caret, caret)
  })
}

function handleVoiceCancelled() {
  if (voiceEntrySource.value === 'overlay') {
    defaultHandleEsc()
    return
  }
  isListening.value = false
  focusPrompt()
}

async function handleVoiceCorrected(
  resultText: string,
  _recognizedText: string,
  _correctedText: string | undefined,
  intent: VoiceFinishIntent
) {
  voiceEntrySource.value = 'input'
  isListening.value = false
  if (intent === 'copy') {
    void actionMenuStore.runDefaultAction('copyToClipboard', resultText)
    return
  }
  if (resultText.trim()) {
    input.insertText(resultText)
    lastInputKind.value = 'voice'
  }
  const textToSend = input.value.value.trim()
  if (intent === 'submit' && textToSend) {
    await model.submitPrompt(textToSend, 'voice', clearPrompt)
    return
  }
  focusPrompt()
}

async function handleQuerySubmit(submitEvent?: QueryPanelSubmit) {
  if (submitEvent?.ctrl) return

  if (submitEvent?.option) {
    applyRecentPrompt(submitEvent.option.label)
    return
  }

  const textToSend = input.value.value.trim()
  const inputKind: 'text' | 'voice' = lastInputKind.value

  if (!textToSend) return

  input.value.value = textToSend
  await model.submitPrompt(textToSend, inputKind, clearPrompt)
}

/** The question moved to the feed: the input is ready for the next one */
function clearPrompt() {
  isFollowUpOpen.value = false
  input.clear()
  lastInputKind.value = 'text'
}

/** Moves on to the main chat; an answer still coming stops there */
async function switchToChat() {
  isListening.value = false
  try {
    await model.switchToChat(input.value.value)
  } catch (error) {
    toastText(describeError(error, t), 'error')
  }
}

function handleEsc() {
  if (model.isGenerating.value) {
    model.stopGeneration()
    return
  }
  if (isListening.value) {
    isListening.value = false
    if (voiceEntrySource.value === 'input') {
      focusPrompt()
      return
    }
  }
  defaultHandleEsc()
}

/** The result surface owns insertion keys; the composer owns text input. */
function handleWindowKeys(event: KeyboardEvent) {
  if (event.defaultPrevented || event.repeat || event.isComposing) return
  if (
    (event.shiftKey && event.code !== 'Space') ||
    event.altKey ||
    event.metaKey
  )
    return
  if (isResultVisible.value && !isInputBlocked.value) {
    if (isApplying.value) return
    if (event.key === 'Escape' && !event.ctrlKey) {
      event.preventDefault()
      handleEsc()
      return
    }
    const target = event.target
    if (
      target instanceof Element &&
      target.closest(
        'input, textarea, select, button, a, [contenteditable="true"], [role="button"]'
      )
    )
      return
    if (window.getSelection()?.toString()) return
    if (
      event.code === 'Space' &&
      event.shiftKey &&
      !event.ctrlKey &&
      resultActionText.value
    ) {
      event.preventDefault()
      openNextStep()
      return
    }
    if (
      !event.ctrlKey &&
      !event.shiftKey &&
      (event.key === 'Enter' || event.key === ' ') &&
      model.selectedReplyBlock.value
    ) {
      event.preventDefault()
      void insertSelectedReply()
    }
    return
  }
  if (event.key !== 'Escape') return
  if (!model.isGenerating.value || menuModalsStore.pendingModal) return
  event.preventDefault()
  model.stopGeneration()
}

function goToSettings() {
  void ipcStore.callOrNotify('activate_mode', { mode: 'config' })
}

onMounted(async () => {
  window.addEventListener('keydown', handleWindowKeys)
  // The models of a provider show up only when its key is known to be set;
  // the quick window has not read the keys yet, or they changed since then.
  await secretsStore.refreshSecrets().catch(() => undefined)
  if (props.isPromptSent && input.value.value.trim() && !disposed) {
    await handleQuerySubmit()
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleWindowKeys)
  disposed = true
  if (navigationStepId !== undefined) {
    menuModalsStore.updateStep(navigationStepId, MenuModals.QUICK_AI_REQUEST, {
      draftMessages: model.getNavigationMessages(),
      draftPrompt: input.value.value,
      isPromptSent: false,
    })
  }
  runtime.dispose()
})
</script>

<style scoped>
.recent-prompts-menu {
  display: inline-flex;
  flex-shrink: 0;
}

.quick-result-actions {
  justify-content: flex-end;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  --shortcut-width: auto;
}

.quick-result-actions .select {
  width: 100%;
  min-width: 0;
}

.screenshot-preview {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md);
}

.screenshot-preview.is-with-turns {
  border-bottom: 1px solid var(--app-border-subtle);
}

.add-screenshot-btn {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  height: 7.5rem;
  min-width: 7.5rem;
  max-width: 11rem;
  padding: var(--space-sm) var(--space-md);
  border: 1px dashed var(--app-border-strong);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--app-text-muted);
  font-size: var(--text-caption);
  line-height: 1.3;
  text-align: center;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}

.add-screenshot-btn:hover:not(:disabled) {
  color: var(--color-base-content);
  background: var(--app-hover);
  border-color: var(--color-primary);
}

.add-screenshot-btn:focus-visible {
  outline: var(--app-focus-outline-width) solid var(--color-primary);
  outline-offset: 2px;
}

.add-screenshot-btn:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.add-screenshot-label {
  overflow-wrap: anywhere;
}

.quick-error-banner {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-sm) var(--space-md);
  background: var(--color-danger-subtle, rgba(239, 68, 68, 0.1));
  border: 1px solid var(--color-danger);
  border-radius: var(--radius-md);
  color: var(--color-danger);
  margin-top: var(--space-sm);
}

.quick-error-text {
  flex: 1;
  font-size: var(--font-size-sm);
}

.quick-error-link {
  font-size: var(--font-size-sm);
  text-decoration: underline;
  background: none;
  border: none;
  color: inherit;
  cursor: pointer;
  padding: 0;
}
</style>
