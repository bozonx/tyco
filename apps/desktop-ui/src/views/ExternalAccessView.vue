<template>
  <ContentPadding>
    <ActionOverlayLayout
      :title="t('externalAccess.title')"
      :esc-label="t('externalAccess.deny')"
      :on-esc="deny"
    >
      <template #preview>
        <div class="access-prompt">
          <AppIcon
            icon="mdi:shield-key-outline"
            size="4xl"
            class="access-prompt-icon"
          />
          <p class="access-prompt-text">
            {{
              t(
                request?.replace
                  ? 'externalAccess.askReplace'
                  : 'externalAccess.askRead',
                { name: request?.commandName ?? '' }
              )
            }}
          </p>
          <p class="access-prompt-note">
            {{ t('externalAccess.unknownCaller') }}
          </p>
          <p class="access-prompt-note">
            {{ t('externalAccess.settingsHint') }}
          </p>
        </div>
      </template>
      <template #actions>
        <!-- nothing is focused: a key meant for the window under the prompt
             must not allow the call -->
        <div class="access-prompt-actions">
          <Button
            variant="primary"
            class="access-allow-once"
            @click="respond('once')"
          >
            {{ t('externalAccess.allowOnce') }}
          </Button>
          <Button
            class="access-allow-always"
            variant="neutral"
            @click="respond('always')"
          >
            {{ t('externalAccess.allowAlways') }}
          </Button>
          <Button class="access-deny" variant="ghost" @click="deny">
            {{ t('externalAccess.deny') }}
          </Button>
        </div>
      </template>
    </ActionOverlayLayout>
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'

import AppIcon from '../components/common/AppIcon.vue'
import Button from '../components/common/Button.vue'
import ContentPadding from '../components/common/ContentPadding.vue'
import ActionOverlayLayout from '../components/overlay/ActionOverlayLayout.vue'
import { useI18n } from '../composables/use-i18n'
import { createAccessPrompt } from '../lib/external-access/access-prompt'
import { useDesktopStore } from '../stores/desktop'
import { useIpcStore } from '../stores/ipc'
import { useNavPanelStore } from '../stores/nav-panel'
import type { AccessDecision } from '@tyco/shared'

const { t } = useI18n()
const ipcStore = useIpcStore()
const desktopStore = useDesktopStore()

useNavPanelStore().resetNavPanelState({ panelVisible: false })

const request = computed(() => desktopStore.desktopState.accessRequest ?? null)

const prompt = createAccessPrompt({
  answer: async (jobId, decision) => {
    const result = await ipcStore.callFunction('answerExternalAccess', [
      jobId,
      decision,
    ])
    if (!result.success) throw new Error(result.error)
  },
})

const respond = (decision: AccessDecision) =>
  prompt.respond(request.value?.jobId, decision)
const deny = () => respond('deny')

const handleKeyUp = (event: KeyboardEvent) => {
  if (event.code === 'Escape' && !event.repeat) {
    event.preventDefault()
    deny()
  }
}

// a request replaced by another one without an answer is denied
watch(
  () => request.value?.jobId,
  (_jobId, previous) => prompt.dismiss(previous)
)

onMounted(() => window.addEventListener('keyup', handleKeyUp))

// the view goes with the window: a prompt closed without an answer denies
onUnmounted(() => {
  window.removeEventListener('keyup', handleKeyUp)
  prompt.dismiss(request.value?.jobId)
})
</script>

<style scoped>
.access-prompt {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  flex: 1;
  padding: var(--space-xl);
  text-align: center;
}

.access-prompt-icon {
  color: var(--color-warning);
}

.access-prompt-text {
  max-width: 36rem;
  font-size: var(--text-title);
  line-height: 1.5;
}

.access-prompt-note {
  max-width: 36rem;
  font-size: var(--text-control);
  color: var(--app-text-muted);
}

.access-prompt-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
