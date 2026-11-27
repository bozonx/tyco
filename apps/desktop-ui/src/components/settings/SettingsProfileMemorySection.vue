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
        </div>

        <StateMessage
          v-if="isLoading && (!topics || topics.length === 0)"
          kind="loading"
          :message="t('common.inProgress')"
        />

        <StateMessage
          v-else-if="isCompacting"
          density="compact"
          kind="loading"
          :message="
            t('settings.profileMemoryCompactTitle', { file: compactingFile })
          "
        />

        <div v-else-if="!topics || topics.length === 0" class="memory-empty">
          {{ t('settings.profileMemoryEmpty') }}
        </div>

        <div v-else class="memory-topics-list">
          <SettingsEntityItem
            v-for="topic in topics"
            :key="topic.file"
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
                  :disabled="isCompacting || isApplying || isDeleting"
                  @click="fileToCompact = topic.file"
                />
                <IconButton
                  size="sm"
                  icon="mdi:square-edit-outline"
                  :label="t('settings.profileMemoryEditFile')"
                  :title="t('settings.profileMemoryEditFile')"
                  :disabled="isSaving || isApplying || isDeleting"
                  @click="openEditor(topic.file)"
                />
                <IconButton
                  size="sm"
                  icon="mdi:trash-can-outline"
                  :label="deleteLabel(topic.file)"
                  :title="deleteLabel(topic.file)"
                  :disabled="isSaving || isApplying || isDeleting"
                  @click="fileToDelete = topic.file"
                />
              </div>
            </template>
          </SettingsEntityItem>
        </div>
      </div>
    </div>

    <!-- Edit modal -->
    <FullTextEditorDialog
      :open="isEditorOpen"
      :title="editingFile"
      icon="mdi:file-document-outline"
      :model-value="editorContent"
      @update:model-value="editorContent = $event"
      @close="closeEditor"
    >
      <template #actions>
        <CopyButton
          v-if="editorContent"
          :value="editorContent"
          :label="t('common.copied')"
        />
        <Button
          size="sm"
          variant="neutral"
          icon="mdi:auto-fix"
          :loading="isCompacting"
          :disabled="
            isCompacting || isApplying || isSaving || !editorContent.trim()
          "
          @click="fileToCompact = editingFile"
        >
          {{ t('settings.profileMemoryCompact') }}
        </Button>
        <Button size="sm" variant="ghost" @click="closeEditor">
          {{ t('common.cancel') }}
        </Button>
        <Button
          size="sm"
          variant="primary"
          icon="mdi:content-save-outline"
          :loading="isSaving"
          :disabled="isApplying || isDeleting"
          @click="saveEditor"
        >
          {{ t('common.save') }}
        </Button>
      </template>
    </FullTextEditorDialog>

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
            :loading="isApplying"
            :disabled="isSaving || isDeleting"
            @click="applyCompaction"
          >
            {{ t('settings.profileMemoryApplyCompact') }}
          </Button>
        </div>
      </div>
    </BaseDialog>

    <ConfirmModal
      :open="Boolean(fileToCompact)"
      :title="t('settings.profileMemoryCompactConfirmTitle')"
      :message="
        t('settings.profileMemoryCompactConfirm', { file: fileToCompact })
      "
      :confirm-text="t('settings.profileMemoryCompact')"
      @confirm="confirmCompaction"
      @cancel="fileToCompact = ''"
    />

    <ConfirmModal
      :open="Boolean(fileToDelete)"
      :title="deleteLabel(fileToDelete)"
      :message="
        fileToDelete === 'core.md'
          ? t('settings.profileMemoryResetCoreConfirm')
          : t('settings.profileMemoryDeleteConfirm', { file: fileToDelete })
      "
      :confirm-text="deleteLabel(fileToDelete)"
      @confirm="handleDeleteFile"
      @cancel="fileToDelete = ''"
    />
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { compactMemoryContent } from '../../lib/ai-profiles/memory-compaction'
import { createMemoryCompactionModel } from '../../lib/ai-profiles/memory-compaction-model'
import { createMemoryEditorModel } from '../../lib/ai-profiles/memory-editor-model'
import { createMemoryTopicsModel } from '../../lib/ai-profiles/memory-topics-model'
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
import CopyButton from '../common/CopyButton.vue'
import Diff from '../common/Diff.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FullTextEditorDialog from '../common/FullTextEditorDialog.vue'
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

const { t, locale } = useI18n()
const { toastKey, toastError } = useToast()
const aiProfilesStore = useAiProfilesStore()
const llmStore = useLlmStore()
const desktopStore = useDesktopStore()
const secretsStore = useSecretsStore()

const modeOptions = computed(() => [
  { id: 'auto', name: t('settings.profileMemoryModeAuto') },
  { id: 'read-only', name: t('settings.profileMemoryModeReadOnly') },
  { id: 'off', name: t('settings.profileMemoryModeOff') },
])

function handleModeChange(value: number | string | undefined) {
  if (value === 'auto' || value === 'read-only' || value === 'off') {
    emit('update:memoryMode', value)
  }
}

const topicsModel = createMemoryTopicsModel({
  list: (id) => aiProfilesStore.listMemoryTopics(id),
  deleteFile: (id, file) => aiProfilesStore.deleteMemoryFile(id, file),
  reportError: toastError,
  onDeleted: (file) => {
    if (editingFile.value === file) editor.closeEditor()
  },
})
const { topics, isLoading, isDeleting } = topicsModel
function loadTopics() {
  if (props.profile.memoryMode === 'off') {
    topicsModel.reset()
    return Promise.resolve()
  }
  return topicsModel.loadTopics(props.profile.id)
}

function topicTitle(topic: ProfileMemoryTopic) {
  if (topic.file === 'core.md') {
    return `core.md (${topic.title})`
  }
  return topic.title ? `${topic.file} — ${topic.title}` : topic.file
}

function topicDescription(topic: ProfileMemoryTopic) {
  const size = formatMemoryTopicSize(topic.bytes, locale.value)
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

const editor = createMemoryEditorModel({
  read: (id, file) => aiProfilesStore.readMemory(id, file),
  write: (id, file, content, expected) =>
    aiProfilesStore.writeMemory(id, file, content, expected),
  reportError: toastError,
  onSaved: () => {
    toastKey('settings.profileMemoryFileSaved', 'info')
    void loadTopics()
  },
})
const {
  isEditorOpen,
  editingFile,
  editorContent,
  isSaving,
  closeEditor,
  saveEditor,
} = editor
function openEditor(file: string) {
  return editor.openEditor(props.profile.id, file)
}
const compaction = createMemoryCompactionModel({
  read: (id, file) => aiProfilesStore.readMemory(id, file),
  write: (id, file, content, expected) =>
    aiProfilesStore.writeMemory(id, file, content, expected),
  compact: (file, content) => {
    const modelId = resolveCompactionModelId()
    return compactMemoryContent({
      file,
      content,
      runModel: (prompt) => llmStore.client.run('chat', prompt, { modelId }),
    })
  },
  reportError: toastError,
  onUnchanged: () => toastKey('settings.profileMemoryCompactNoChange', 'info'),
  onApplied: (id, file, original, content) => {
    editor.replaceContent(id, file, original, content)
    toastKey('settings.profileMemoryCompactSuccess', 'info')
    void loadTopics()
  },
})
const {
  isCompacting,
  isApplying,
  isDiffModalOpen,
  compactingFile,
  diffOldText,
  diffNewText,
  closeDiffModal,
  applyCompaction,
} = compaction
function startCompaction(file: string) {
  return compaction.startCompaction(props.profile.id, file)
}
function compactCurrentEditor() {
  if (!editingFile.value || !editorContent.value.trim()) return
  return compaction.startCompaction(
    props.profile.id,
    editingFile.value,
    editorContent.value
  )
}
watch(
  () => [props.profile.id, props.profile.memoryMode] as const,
  () => {
    editor.closeEditor()
    compaction.closeDiffModal()
    topicsModel.reset()
    fileToDelete.value = ''
    fileToCompact.value = ''
    void loadTopics()
  }
)
onScopeDispose(() => {
  editor.dispose()
  compaction.dispose()
  topicsModel.dispose()
})

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

/** The file waiting for the user to confirm its deletion */
const fileToDelete = ref('')
/** The file waiting for the user to confirm its compaction */
const fileToCompact = ref('')
void loadTopics()

/** `core.md` always exists: it is cleared, a topic file is deleted */
const deleteLabel = (file: string) =>
  file === 'core.md'
    ? t('settings.profileMemoryResetCore')
    : t('settings.profileMemoryDeleteFile')

function confirmCompaction() {
  const file = fileToCompact.value
  fileToCompact.value = ''
  if (!file) return
  // the open editor compacts what it shows, unsaved changes too
  if (isEditorOpen.value && editingFile.value === file)
    void compactCurrentEditor()
  else void startCompaction(file)
}

async function handleDeleteFile() {
  const file = fileToDelete.value
  fileToDelete.value = ''
  if (!file || isSaving.value || isApplying.value) return
  if (compactingFile.value === file) compaction.closeDiffModal()
  await topicsModel.deleteFile(props.profile.id, file)
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
  overscroll-behavior: contain;
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
