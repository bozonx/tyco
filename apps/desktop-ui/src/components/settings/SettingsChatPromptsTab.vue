<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('settings.chatPromptsTab')"
      :info="t('settings.chatPromptsHint')"
    >
      <div class="flex items-center gap-2">
        <FieldSwitch
          :model-value="chatPrompts.isSentImmediately"
          :label="t('settings.chatPromptsSentImmediately')"
          @update:model-value="setSentImmediately"
        />
        <InfoTooltip :text="t('settings.chatPromptsSentImmediatelyInfo')" />
      </div>
    </SettingsSection>
    <SettingsSection bare>
      <template #actions>
        <Button variant="primary" size="sm" icon="mdi:plus" @click="addPrompt">
          {{ t('settings.addChatPrompt') }}
        </Button>
      </template>

      <StateMessage
        v-if="!prompts.length"
        class="chat-prompts-empty"
        :message="t('chatPrompts.empty')"
      />

      <div v-else ref="listRef" class="chat-prompts-list">
        <div
          v-for="(prompt, index) in prompts"
          :key="prompt.id"
          data-sortable-item
          class="chat-prompt-card"
          :class="{
            'is-sorting': isSorting,
            'is-dragged': draggedIndex === index,
          }"
          :style="itemStyle(index)"
        >
          <div class="chat-prompt-card-drag">
            <DragHandle @drag="startDrag(index, $event)" />
          </div>
          <div class="chat-prompt-card-content">
            <div class="chat-prompt-card-row">
              <FieldInput
                class="chat-prompt-card-name"
                :model-value="prompt.name"
                :placeholder="t('settings.name')"
                :aria-label="t('settings.name')"
                @update:model-value="updatePrompt(index, { name: $event })"
              />
              <FieldSelect
                class="chat-prompt-card-profile"
                :model-value="prompt.profileId"
                :options="profileOptions(prompt)"
                :aria-label="t('settings.chatPromptProfile')"
                :title="t('settings.chatPromptProfile')"
                @update:model-value="setProfile(index, $event)"
              />
            </div>
            <InlineNotice
              v-if="isProfileMissing(prompt)"
              kind="warning"
              :message="t('chatPrompts.profileMissing')"
            />
            <FieldPromptTextArea
              :model-value="prompt.rule"
              :placeholder="t('settings.prompt')"
              :aria-label="t('settings.prompt')"
              :modal-title="prompt.name || t('settings.prompt')"
              @update:model-value="updatePrompt(index, { rule: $event })"
            />
          </div>
          <div class="chat-prompt-card-actions">
            <IconButton
              size="sm"
              variant="ghost"
              icon="mdi:trash-can-outline"
              :label="t('common.delete')"
              @click="removePrompts([prompt.id])"
            />
          </div>
        </div>
      </div>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { type CSSProperties, computed, nextTick, onUnmounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { useSortableList } from '../../composables/use-sortable-list'
import {
  chatPromptProfileOptions,
  describeChatPrompt,
  emptyChatPromptIds,
  moveChatPrompt,
  newChatPrompt,
  withoutChatPrompts,
} from '../../lib/chat-prompts/chat-prompts'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Button from '../common/Button.vue'
import DragHandle from '../common/DragHandle.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldPromptTextArea from '../common/FieldPromptTextArea.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import IconButton from '../common/IconButton.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import InlineNotice from '../common/InlineNotice.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsSection from './SettingsSection.vue'
import { type ChatPromptConfig, type ChatPromptsConfig } from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()
const aiProfilesStore = useAiProfilesStore()

if (!aiProfilesStore.isLoaded) void aiProfilesStore.loadAll()

const listRef = ref<HTMLElement | null>(null)

const chatPrompts = computed<ChatPromptsConfig>(
  () => userConfig.value.chatPrompts
)
const prompts = computed(() => chatPrompts.value.items)

function setPrompts(items: ChatPromptConfig[]) {
  userConfig.value.chatPrompts = { ...chatPrompts.value, items }
}

const { draggedIndex, isSorting, startDrag, itemOffset } = useSortableList(
  listRef,
  (from, to) => setPrompts(moveChatPrompt(prompts.value, from, to))
)

const itemStyle = (index: number): CSSProperties | undefined => {
  const offset = itemOffset(index)
  if (!offset) return undefined
  return { transform: `translate3d(0, ${offset}px, 0)` }
}

const profileSources = computed(() => ({
  profiles: aiProfilesStore.profiles,
  areProfilesLoaded: aiProfilesStore.isLoaded,
}))

const isProfileMissing = (prompt: ChatPromptConfig) =>
  describeChatPrompt(prompt, profileSources.value).isProfileMissing

const profileOptions = (prompt: ChatPromptConfig) =>
  chatPromptProfileOptions(prompt, profileSources.value, {
    everyProfile: t('chatPrompts.everyProfile'),
    missingProfile: t('chatPrompts.missingProfile'),
  })

function setSentImmediately(value: boolean) {
  userConfig.value.chatPrompts = {
    ...chatPrompts.value,
    isSentImmediately: value,
  }
}

function addPrompt() {
  setPrompts([...prompts.value, newChatPrompt(prompts.value)])
  void nextTick(() => {
    const cards = listRef.value?.querySelectorAll('.chat-prompt-card')
    const lastCard = cards?.[cards.length - 1] as HTMLElement | undefined
    lastCard?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
    lastCard?.querySelector('input')?.focus()
  })
}

function updatePrompt(index: number, patch: Partial<ChatPromptConfig>) {
  setPrompts(
    prompts.value.map((item, i) => (i === index ? { ...item, ...patch } : item))
  )
}

function setProfile(index: number, value: string | number | undefined) {
  updatePrompt(index, { profileId: typeof value === 'string' ? value : '' })
}

/** Removes the prompts and the actions that run them */
function removePrompts(ids: readonly string[]) {
  if (!ids.length) return
  Object.assign(userConfig.value, withoutChatPrompts(userConfig.value, ids))
}

/** A prompt left without a name and a text is dropped */
onUnmounted(() => {
  removePrompts(emptyChatPromptIds(prompts.value))
})
</script>

<style scoped>
.chat-prompts-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}

.chat-prompt-card {
  display: flex;
  align-items: flex-start;
  gap: var(--space-xs);
  padding: var(--space-sm);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-lg);
  transition:
    transform var(--transition-base),
    opacity var(--transition-fast);
}

.chat-prompt-card.is-sorting {
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    transform var(--transition-base);
}

.chat-prompt-card.is-dragged {
  position: relative;
  z-index: 1;
  box-shadow: var(--app-shadow-lg);
  border-color: var(--color-primary);
  transition: none;
}

.chat-prompt-card-drag {
  padding-top: var(--space-xs);
  flex-shrink: 0;
}

.chat-prompt-card-content {
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.chat-prompt-card-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}

.chat-prompt-card-name {
  flex: 1 1 12rem;
  min-width: 0;
}

.chat-prompt-card-profile {
  flex: 0 1 14rem;
  min-width: 0;
}

.chat-prompt-card-actions {
  flex-shrink: 0;
}

.chat-prompts-empty {
  padding: var(--space-xl) var(--space-md);
}
</style>
