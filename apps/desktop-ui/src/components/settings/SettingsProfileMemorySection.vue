<template>
  <SettingsSection
    :title="t('settings.profileMemoryTitle')"
    :info="t('settings.profileMemoryHint')"
  >
    <div class="settings-section-content">
      <FieldRow :label="t('settings.profileMemoryMode')">
        <FieldSelect
          :model-value="profile.memoryMode ?? 'auto'"
          :options="modeOptions"
          @update:model-value="handleModeChange"
        />
      </FieldRow>

      <InlineNotice
        v-if="profile.memoryMode === 'off'"
        density="compact"
        kind="info"
        icon="mdi:database-off-outline"
        :message="t('settings.profileMemoryDisabledNotice')"
      />

      <div v-else class="memory-topics-stack">
        <div class="memory-topics-header">
          <span class="memory-topics-title">
            {{ t('settings.profileMemoryFiles') }}
          </span>
          <div class="memory-header-actions">
            <Button
              size="xs"
              variant="neutral"
              icon="mdi:refresh"
              :disabled="isLoading"
              @click="loadTopics"
            >
              {{ t('settings.profileMemoryRefresh') }}
            </Button>
            <Button
              size="xs"
              variant="danger"
              icon="mdi:trash-can-outline"
              :disabled="isLoading || !topics || topics.length === 0"
              @click="isConfirmClearOpen = true"
            >
              {{ t('settings.profileMemoryClear') }}
            </Button>
          </div>
        </div>

        <StateMessage
          v-if="isLoading && (!topics || topics.length === 0)"
          kind="loading"
        />

        <div v-else-if="!topics || topics.length === 0" class="memory-empty">
          {{ t('settings.profileMemoryEmpty') }}
        </div>

        <div v-else class="memory-topics-list">
          <SettingsEntityItem
            v-for="topic in topics"
            :key="topic.file"
            :icon="
              topic.file === 'core.md'
                ? 'mdi:brain'
                : 'mdi:file-document-outline'
            "
            :icon-tone="topic.file === 'core.md' ? 'primary' : 'secondary'"
            :title="topicTitle(topic)"
            :description="topicDescription(topic)"
          >
            <template #actions>
              <div class="topic-actions">
                <Badge
                  v-if="topicWarning(topic)"
                  :kind="topicWarning(topic)!.kind"
                  size="sm"
                >
                  {{ topicWarning(topic)!.label }}
                </Badge>
                <IconButton
                  size="sm"
                  icon="mdi:auto-fix"
                  :label="t('settings.profileMemoryCompact')"
                  :title="t('settings.profileMemoryCompact')"
                  :disabled="isCompacting"
                  @click="startCompaction(topic.file)"
                />
                <IconButton
                  size="sm"
                  icon="mdi:square-edit-outline"
                  :label="t('settings.profileMemoryEditFile')"
                  :title="t('settings.profileMemoryEditFile')"
                  @click="openEditor(topic.file)"
                />
              </div>
            </template>
          </SettingsEntityItem>
        </div>
      </div>
    </div>

    <!-- Edit modal -->
    <BaseDialog :open="isEditorOpen" :label="editingFile" @close="closeEditor">
      <div class="memory-dialog-box">
        <div class="memory-dialog-header">
          <AppIcon icon="mdi:square-edit-outline" size="lg" />
          <h3 class="memory-dialog-title">{{ editingFile }}</h3>
        </div>
        <div class="memory-dialog-body">
          <FieldTextArea
            v-model="editorContent"
            :rows="14"
            auto-resize
            :max-auto-height="500"
            :aria-label="editingFile"
          />
        </div>
        <div class="memory-dialog-actions">
          <Button size="sm" variant="ghost" @click="closeEditor">
            {{ t('common.cancel') }}
          </Button>
          <Button
            size="sm"
            variant="neutral"
            icon="mdi:auto-fix"
            :disabled="isCompacting || !editorContent.trim()"
            @click="compactCurrentEditor"
          >
            {{ t('settings.profileMemoryCompact') }}
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="mdi:content-save-outline"
            :disabled="isSaving"
            @click="saveEditor"
          >
            {{ t('common.save') }}
          </Button>
        </div>
      </div>
    </BaseDialog>

    <!-- Compaction Diff Modal -->
    <BaseDialog
      :open="isDiffModalOpen"
      :label="t('settings.profileMemoryCompactTitle', { file: compactingFile })"
      @close="closeDiffModal"
    >
      <div class="memory-dialog-box">
        <div class="memory-dialog-header">
          <AppIcon icon="mdi:auto-fix" size="lg" />
          <h3 class="memory-dialog-title">
            {{
              t('settings.profileMemoryCompactTitle', { file: compactingFile })
            }}
          </h3>
        </div>
        <div class="memory-dialog-diff">
          <Diff
            :old-text="diffOldText"
            :new-text="diffNewText"
            mode="unified"
          />
        </div>
        <div class="memory-dialog-actions">
          <Button size="sm" variant="ghost" @click="closeDiffModal">
            {{ t('common.cancel') }}
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon="mdi:check"
            @click="applyCompaction"
          >
            {{ t('settings.profileMemoryApplyCompact') }}
          </Button>
        </div>
      </div>
    </BaseDialog>

    <!-- Clear Confirm Modal -->
    <ConfirmModal
      :open="isConfirmClearOpen"
      :title="t('settings.profileMemoryClearTitle')"
      :message="t('settings.profileMemoryClearConfirm')"
      :confirm-text="t('settings.profileMemoryClear')"
      danger
      @confirm="handleClearMemory"
      @cancel="isConfirmClearOpen = false"
    />
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { compactMemoryContent } from '../../lib/ai-profiles/memory-compaction'
import {
  chatModelOptions,
  pickScopedChatModel,
} from '../../lib/chat/chat-llm-selection'
import {
  CORE_MEMORY_HARD_LIMIT_TOKENS,
  CORE_MEMORY_WARN_TOKENS,
  TOPIC_MEMORY_HARD_LIMIT_TOKENS,
  TOPIC_MEMORY_WARN_TOKENS,
  estimateMemoryTokens,
  formatMemoryTopicSize,
} from '../../lib/chat/chat-profile-memory'
import { normalizeLlmConfig } from '../../lib/llm/llm-config'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import { useDesktopStore } from '../../stores/desktop'
import { useLlmStore } from '../../stores/llm'
import { useSecretsStore } from '../../stores/secrets'
import AppIcon from '../common/AppIcon.vue'
import Badge from '../common/Badge.vue'
import BaseDialog from '../common/BaseDialog.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import Diff from '../common/Diff.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import IconButton from '../common/IconButton.vue'
import InlineNotice from '../common/InlineNotice.vue'
import StateMessage from '../common/StateMessage.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import SettingsSection from './SettingsSection.vue'
import {
  type AiProfile,
  type ProfileMemoryMode,
  type ProfileMemoryTopic,
  llmSecretId,
} from '@tyco/shared'

const props = defineProps<{ profile: AiProfile }>()

const emit = defineEmits<{
  (e: 'update:memoryMode', mode: ProfileMemoryMode): void
}>()

const { t } = useI18n()
const { toastKey, toastError } = useToast()
const aiProfilesStore = useAiProfilesStore()
const llmStore = useLlmStore()
const desktopStore = useDesktopStore()
const secretsStore = useSecretsStore()

const modeOptions = computed(() => [
  { id: 'auto', name: t('settings.profileMemoryModeAuto') },
  { id: 'ask', name: t('settings.profileMemoryModeAsk') },
  { id: 'read-only', name: t('settings.profileMemoryModeReadOnly') },
  { id: 'off', name: t('settings.profileMemoryModeOff') },
])

function handleModeChange(value: number | string | undefined) {
  if (value && typeof value === 'string') {
    emit('update:memoryMode', value as ProfileMemoryMode)
  }
}

// Topics
const topics = ref<ProfileMemoryTopic[]>([])
const isLoading = ref(false)

async function loadTopics() {
  if (props.profile.memoryMode === 'off') {
    topics.value = []
    return
  }
  isLoading.value = true
  try {
    topics.value =
      (await aiProfilesStore.listMemoryTopics(props.profile.id)) ?? []
  } catch (error) {
    topics.value = []
    toastError(error)
  } finally {
    isLoading.value = false
  }
}

watch(
  () => props.profile.id,
  () => void loadTopics(),
  { immediate: true }
)

watch(
  () => props.profile.memoryMode,
  (mode) => {
    if (mode === 'off') {
      topics.value = []
    } else {
      void loadTopics()
    }
  }
)

function topicTitle(topic: ProfileMemoryTopic) {
  if (topic.file === 'core.md') {
    return `core.md (${topic.title})`
  }
  return topic.title ? `${topic.file} — ${topic.title}` : topic.file
}

function topicDescription(topic: ProfileMemoryTopic) {
  const size = formatMemoryTopicSize(topic.bytes)
  const tokens = estimateMemoryTokens(topic.bytes)
  const tokensText = t('settings.profileMemoryTokens', {
    tokens: String(tokens),
  })
  return `${size} · ${tokensText}`
}

function topicWarning(
  topic: ProfileMemoryTopic
): { label: string; kind: 'warning' | 'error' } | null {
  const tokens = estimateMemoryTokens(topic.bytes)
  if (topic.file === 'core.md') {
    if (tokens > CORE_MEMORY_HARD_LIMIT_TOKENS) {
      return { label: t('settings.profileMemoryHardCore'), kind: 'error' }
    }
    if (tokens > CORE_MEMORY_WARN_TOKENS) {
      return { label: t('settings.profileMemoryWarnCore'), kind: 'warning' }
    }
  } else {
    if (tokens > TOPIC_MEMORY_HARD_LIMIT_TOKENS) {
      return { label: t('settings.profileMemoryHardTopic'), kind: 'error' }
    }
    if (tokens > TOPIC_MEMORY_WARN_TOKENS) {
      return { label: t('settings.profileMemoryWarnTopic'), kind: 'warning' }
    }
  }
  return null
}

// Editor modal
const isEditorOpen = ref(false)
const editingFile = ref('')
const editorContent = ref('')
const isSaving = ref(false)

async function openEditor(file: string) {
  editingFile.value = file
  try {
    editorContent.value = await aiProfilesStore.readMemory(
      props.profile.id,
      file
    )
    isEditorOpen.value = true
  } catch (error) {
    toastError(error)
  }
}

function closeEditor() {
  isEditorOpen.value = false
  editingFile.value = ''
  editorContent.value = ''
}

async function saveEditor() {
  if (!editingFile.value) return
  isSaving.value = true
  try {
    await aiProfilesStore.writeMemory(
      props.profile.id,
      editingFile.value,
      editorContent.value
    )
    toastKey('settings.profileMemoryFileSaved', 'info')
    closeEditor()
    await loadTopics()
  } catch (error) {
    toastError(error)
  } finally {
    isSaving.value = false
  }
}

// Compaction
const isCompacting = ref(false)
const isDiffModalOpen = ref(false)
const compactingFile = ref('')
const diffOldText = ref('')
const diffNewText = ref('')

async function startCompaction(file: string) {
  isCompacting.value = true
  try {
    const content = await aiProfilesStore.readMemory(props.profile.id, file)
    await runCompactionFlow(file, content)
  } catch (error) {
    toastError(error)
  } finally {
    isCompacting.value = false
  }
}

async function compactCurrentEditor() {
  if (!editingFile.value || !editorContent.value.trim()) return
  isCompacting.value = true
  try {
    await runCompactionFlow(editingFile.value, editorContent.value)
  } catch (error) {
    toastError(error)
  } finally {
    isCompacting.value = false
  }
}

function resolveCompactionModelId(): string | undefined {
  if (props.profile.modelId) return props.profile.modelId
  const config = normalizeLlmConfig(desktopStore.userConfig?.llm)
  const options = chatModelOptions(config, (id) =>
    Boolean(secretsStore.secrets[llmSecretId(id)])
  )
  return (
    pickScopedChatModel(options, {
      profileId: props.profile.id,
      profileModelId: props.profile.modelId,
    })?.id ?? options[0]?.id
  )
}

async function runCompactionFlow(file: string, content: string) {
  const modelId = resolveCompactionModelId()
  const result = await compactMemoryContent({
    file,
    content,
    runModel: async (prompt) => {
      return await llmStore.client.run('chat', prompt, { modelId })
    },
  })

  if (result.trim() === content.trim()) {
    toastKey('settings.profileMemoryCompactNoChange', 'info')
    return
  }

  compactingFile.value = file
  diffOldText.value = content
  diffNewText.value = result
  isDiffModalOpen.value = true
}

function closeDiffModal() {
  isDiffModalOpen.value = false
  compactingFile.value = ''
  diffOldText.value = ''
  diffNewText.value = ''
}

async function applyCompaction() {
  if (!compactingFile.value) return
  try {
    await aiProfilesStore.writeMemory(
      props.profile.id,
      compactingFile.value,
      diffNewText.value
    )
    toastKey('settings.profileMemoryCompactSuccess', 'info')
    if (isEditorOpen.value && editingFile.value === compactingFile.value) {
      editorContent.value = diffNewText.value
    }
    closeDiffModal()
    await loadTopics()
  } catch (error) {
    toastError(error)
  }
}

// Clear memory
const isConfirmClearOpen = ref(false)

async function handleClearMemory() {
  isConfirmClearOpen.value = false
  try {
    await aiProfilesStore.clearMemory(props.profile.id)
    toastKey('settings.profileMemoryClearSuccess', 'info')
    await loadTopics()
  } catch (error) {
    toastError(error)
  }
}
</script>

<style scoped>
.memory-topics-stack {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  margin-top: var(--space-sm);
}

.memory-topics-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-xs) 0;
}

.memory-topics-title {
  font-weight: 500;
  font-size: var(--text-control);
  color: var(--app-text-muted);
}

.memory-header-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.memory-topics-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.topic-actions {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.memory-empty {
  padding: var(--space-md);
  color: var(--app-text-muted);
  font-size: var(--text-caption);
  text-align: center;
  border: 1px dashed var(--app-border-subtle);
  border-radius: var(--radius-md);
}

.memory-dialog-box {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  min-width: min(90vw, 40rem);
  padding: var(--space-md);
}

.memory-dialog-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.memory-dialog-title {
  margin: 0;
  font-size: var(--text-title);
  font-weight: 600;
}

.memory-dialog-body {
  display: flex;
  flex-direction: column;
}

.memory-dialog-diff {
  overflow: auto;
  max-height: 25rem;
  padding: var(--space-xs);
  background: var(--app-surface-raised);
  border-radius: var(--radius-sm);
}

.memory-dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
