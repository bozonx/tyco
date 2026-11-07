<template>
  <span
    v-if="props.view.isProfileMissing"
    class="chat-prompt-profile is-missing"
    :title="t('chatPrompts.profileMissing')"
  >
    <AppIcon icon="mdi:alert-outline" size="xs" />
    <span class="chat-prompt-profile-name">{{
      t('chatPrompts.missingProfile')
    }}</span>
  </span>
  <span
    v-else-if="props.view.profileName"
    class="chat-prompt-profile"
    :title="props.view.profileName"
  >
    <AppIcon icon="mdi:account-circle-outline" size="xs" />
    <span class="chat-prompt-profile-name">{{ props.view.profileName }}</span>
  </span>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import type { ChatPromptView } from '../../lib/chat-prompts/chat-prompts'
import AppIcon from '../common/AppIcon.vue'

/** The profile a prompt belongs to; nothing for a prompt of every profile */
const props = defineProps<{ view: ChatPromptView }>()

const { t } = useI18n()
</script>

<style scoped>
.chat-prompt-profile {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  min-width: 0;
  max-width: 100%;
  font-size: var(--text-caption);
  color: var(--color-primary);
}

.chat-prompt-profile.is-missing {
  color: var(--color-warning);
}

.chat-prompt-profile-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
