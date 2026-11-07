<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('settings.chatPromptsTab')"
      :info="t('settings.chatPromptsHint')"
    >
      <FieldSwitch
        :model-value="chatPrompts.isSentImmediately"
        :label="t('settings.chatPromptsSentImmediately')"
        @update:model-value="setSentImmediately"
      />
    </SettingsSection>
    <SettingsSection bare>
      <div class="flex flex-wrap items-center gap-2 mb-3">
        <PromptPagesBar
          v-if="views.length"
          :pages="views"
          :active-index="page"
          :label="pageLabel"
          @select="page = $event"
        />
        <Button size="sm" icon="mdi:plus" @click="addPage">
          {{ t('settings.addPromptPage') }}
        </Button>
      </div>
      <p v-if="!views.length" class="text-sm text-muted">
        {{ t('chatPrompts.noPages') }}
      </p>
      <template v-if="currentPage">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <label class="flex items-center gap-2">
            <span class="text-sm">{{ t('settings.promptPageProfile') }}</span>
            <FieldSelect
              size="sm"
              :model-value="currentPage.profileId"
              :options="profileOptions"
              @update:model-value="setProfile"
            />
          </label>
          <IconButton
            variant="ghost"
            size="sm"
            icon="mdi:chevron-left"
            :label="t('settings.movePromptPageBack')"
            :disabled="page === 0"
            @click="movePage(-1)"
          />
          <IconButton
            variant="ghost"
            size="sm"
            icon="mdi:chevron-right"
            :label="t('settings.movePromptPageForward')"
            :disabled="page >= views.length - 1"
            @click="movePage(1)"
          />
          <Button
            variant="ghost"
            class="ml-auto"
            size="sm"
            icon="mdi:trash-can-outline"
            @click="isRemoveConfirmOpen = true"
          >
            {{ t('settings.removePromptPage') }}
          </Button>
        </div>
        <InlineNotice
          v-if="views[page]?.isProfileMissing"
          class="mb-3"
          kind="warning"
          :message="t('chatPrompts.profileMissing')"
        />
        <RuleLibrarySettings
          :key="page"
          id-prefix="chat-prompt"
          prompt-placeholder-key="settings.prompt"
          :library="currentPage"
          @update:library="updatePage"
        />
      </template>
    </SettingsSection>
    <ConfirmModal
      :open="isRemoveConfirmOpen"
      :title="t('settings.removePromptPage')"
      :message="t('settings.removePromptPageConfirm')"
      :confirm-text="t('common.remove')"
      danger
      @confirm="removePage"
      @cancel="isRemoveConfirmOpen = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { usePromptPages } from '../../composables/use-prompt-pages'
import { useSettingsContext } from '../../composables/use-settings-context'
import {
  type SlotLibrary,
  type SlotLibraryItem,
  withoutEmptySlotItems,
} from '../../lib/shortcut-slots/slot-library'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import IconButton from '../common/IconButton.vue'
import InlineNotice from '../common/InlineNotice.vue'
import PromptPagesBar from '../menu/PromptPagesBar.vue'
import RuleLibrarySettings from './RuleLibrarySettings.vue'
import SettingsSection from './SettingsSection.vue'
import type { ChatPromptPageConfig, ChatPromptsConfig } from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()
const aiProfilesStore = useAiProfilesStore()

const chatPrompts = computed<ChatPromptsConfig>(
  () => userConfig.value.chatPrompts
)
const { views, pageLabel } = usePromptPages(() => chatPrompts.value.pages)

const page = ref(0)
const isRemoveConfirmOpen = ref(false)
const currentPage = computed(() => chatPrompts.value.pages[page.value])

const profileOptions = computed(() => {
  const options = [
    { id: '', name: t('quickAiRequest.defaultProfile') },
    ...aiProfilesStore.profiles.map((p) => ({ id: p.id, name: p.name })),
  ]
  const profileId = currentPage.value?.profileId
  if (profileId && !options.some((option) => option.id === profileId)) {
    options.push({ id: profileId, name: t('chatPrompts.missingProfile') })
  }
  return options
})

function setPages(pages: ChatPromptPageConfig[]) {
  userConfig.value.chatPrompts = { ...chatPrompts.value, pages }
}

function setSentImmediately(value: boolean) {
  userConfig.value.chatPrompts = {
    ...chatPrompts.value,
    isSentImmediately: value,
  }
}

function addPage() {
  setPages([
    ...chatPrompts.value.pages,
    { profileId: '', items: [], slots: {} },
  ])
  page.value = chatPrompts.value.pages.length - 1
}

function updatePage(library: SlotLibrary<SlotLibraryItem>) {
  setPages(
    chatPrompts.value.pages.map((item, index) =>
      index === page.value ? { ...item, ...library } : item
    )
  )
}

function setProfile(value: string | number | undefined) {
  const profileId = typeof value === 'string' ? value : ''
  setPages(
    chatPrompts.value.pages.map((item, index) =>
      index === page.value ? { ...item, profileId } : item
    )
  )
}

function movePage(delta: number) {
  const target = page.value + delta
  const pages = [...chatPrompts.value.pages]
  if (target < 0 || target >= pages.length) return
  const [moved] = pages.splice(page.value, 1)
  pages.splice(target, 0, moved!)
  setPages(pages)
  page.value = target
}

function removePage() {
  isRemoveConfirmOpen.value = false
  setPages(chatPrompts.value.pages.filter((_, index) => index !== page.value))
  page.value = Math.max(
    0,
    Math.min(page.value, chatPrompts.value.pages.length - 1)
  )
}

onUnmounted(() => {
  const pages = chatPrompts.value.pages
  const cleaned = pages.map((item) => withoutEmptySlotItems(item))
  if (
    cleaned.some(
      (item, index) => item.items.length !== pages[index]!.items.length
    )
  ) {
    setPages(cleaned)
  }
})
</script>
