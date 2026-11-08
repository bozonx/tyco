<template>
  <!-- The profile and the model a quick AI request is asked with, shown under its input -->
  <div class="quick-ai-model-bar">
    <label class="quick-ai-model-field">
      <AppIcon
        icon="mdi:account-outline"
        size="sm"
        class="quick-ai-model-icon"
      />
      <FieldSelect
        size="sm"
        :model-value="props.profileId ?? ''"
        :disabled="props.isProfileLocked"
        :options="profileOptions"
        :title="
          props.isProfileLocked
            ? t('quickAiRequest.profileLocked')
            : t('quickAiRequest.selectProfile')
        "
        @update:model-value="onProfileSelect"
      />
    </label>
    <label class="quick-ai-model-field">
      <AppIcon
        icon="mdi:creation-outline"
        size="sm"
        class="quick-ai-model-icon"
      />
      <FieldSelect
        size="sm"
        :model-value="props.modelId ?? ''"
        :disabled="props.isModelDisabled"
        :options="modelOptions"
        :title="t('chat.selectModel')"
        @update:model-value="onModelSelect"
      />
    </label>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { ChatLlmOption } from '../../lib/chat/chat-llm-selection'
import { useAiProfilesStore } from '../../stores/ai-profiles'
import AppIcon from '../common/AppIcon.vue'
import FieldSelect from '../common/FieldSelect.vue'

const props = withDefaults(
  defineProps<{
    /** Null: the default profile, without SOUL.md and memory */
    profileId: string | null
    modelId: string | null
    models: readonly ChatLlmOption[]
    isProfileLocked?: boolean
    isModelDisabled?: boolean
  }>(),
  { isProfileLocked: false, isModelDisabled: false }
)

const emit = defineEmits<{
  'update:profileId': [profileId: string | null]
  'update:modelId': [modelId: string]
}>()

const { t } = useI18n()
const aiProfilesStore = useAiProfilesStore()

const profileOptions = computed(() => [
  { id: '', name: t('quickAiRequest.standardProfile') },
  ...aiProfilesStore.profiles.map((profile) => ({
    id: profile.id,
    name: profile.name,
  })),
])

const modelOptions = computed(() => [
  // without a pick the select would show nothing at all
  ...(props.modelId
    ? []
    : [{ id: '', name: t('chat.selectModel'), disabled: true }]),
  ...props.models.map((option) => ({
    id: option.id,
    name: [
      option.name,
      option.providerLabel,
      ...(option.canUseTools ? [] : [t('chat.noToolCalling')]),
    ].join(' · '),
  })),
])

function onProfileSelect(value: string | number | undefined) {
  emit('update:profileId', typeof value === 'string' && value ? value : null)
}

function onModelSelect(value: string | number | undefined) {
  if (typeof value === 'string' && value) emit('update:modelId', value)
}

// The quick window may hold a list read before a profile was added elsewhere
onMounted(() => {
  void aiProfilesStore.loadAll()
})
</script>

<style scoped>
.quick-ai-model-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-sm);
  min-width: 0;
}

.quick-ai-model-field {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
  max-width: 18rem;
  cursor: pointer;
}

.quick-ai-model-icon {
  flex-shrink: 0;
  color: var(--color-text-subtle);
}
</style>
