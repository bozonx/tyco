<template>
  <ContentPadding>
    <ActionOverlayLayout
      :title="title"
      :esc-label="isActive ? t('common.cancel') : t('common.close')"
      :on-esc="cancel"
    >
      <template #preview>
        <div v-if="state.phase === 'access'" class="command-run-message">
          <AppIcon
            icon="mdi:shield-key-outline"
            size="4xl"
            class="command-run-access-icon"
          />
          <p class="command-run-text">
            {{
              t(
                state.shouldReplace
                  ? 'externalAccess.askReplace'
                  : 'externalAccess.askRead',
                { name: state.commandName }
              )
            }}
          </p>
          <p class="command-run-note">
            {{ t('externalAccess.unknownCaller') }}
          </p>
          <p class="command-run-note">
            {{ t('externalAccess.settingsHint') }}
          </p>
        </div>
        <div v-else-if="state.phase === 'input'" class="command-run-input">
          <FieldTextArea
            v-model="inputText"
            class="command-run-input-field"
            :placeholder="t('commandRun.inputPlaceholder')"
            :rows="8"
            autofocus
            @keydown="onInputKeydown"
          />
        </div>
        <StateMessage
          v-else-if="state.phase === 'running'"
          class="command-run-state"
          kind="loading"
          :title="t('commandRun.running', { name: state.commandName })"
          :message="state.status?.text"
        />
        <TextPreview
          v-else-if="state.phase === 'result' && state.output"
          class="command-run-output"
          :text="state.output"
        />
        <StateMessage
          v-else-if="state.phase === 'result'"
          class="command-run-state"
          kind="info"
          :title="t('commandRun.done', { name: state.commandName })"
          :message="state.message"
        />
        <StateMessage
          v-else-if="state.phase === 'failed'"
          class="command-run-state"
          kind="error"
          :title="t('commandRun.failed', { name: state.commandName })"
          :message="state.message"
        />
        <StateMessage
          v-else-if="state.phase === 'cancelled'"
          class="command-run-state"
          kind="info"
          :title="t('commandRun.cancelledTitle', { name: state.commandName })"
          :message="state.message"
        />
      </template>
      <template #actions>
        <!-- nothing is focused in the prompt: a key meant for the window under
             it must not allow the call -->
        <div class="command-run-actions">
          <template v-if="state.phase === 'access'">
            <Button
              variant="primary"
              class="access-allow-once"
              @click="store.respondAccess('once')"
            >
              {{ t('externalAccess.allowOnce') }}
            </Button>
            <Button
              class="access-allow-always"
              variant="neutral"
              @click="store.respondAccess('always')"
            >
              {{ t('externalAccess.allowAlways') }}
            </Button>
            <Button
              class="access-deny"
              variant="ghost"
              @click="store.respondAccess('deny')"
            >
              {{ t('externalAccess.deny') }}
            </Button>
          </template>
          <template v-else-if="state.phase === 'input'">
            <Button class="command-run-cancel" variant="ghost" @click="cancel">
              {{ t('common.cancel') }}
            </Button>
            <Button
              class="command-run-submit"
              variant="primary"
              @click="submit"
            >
              {{ t('commandRun.run') }}
            </Button>
          </template>
          <Button
            v-else-if="state.phase === 'running'"
            class="command-run-cancel"
            variant="neutral"
            @click="cancel"
          >
            {{ t('common.cancel') }}
          </Button>
          <template v-else>
            <CopyButton
              v-if="state.phase === 'result' && state.output"
              class="command-run-copy"
              :value="state.output"
              :label="t('common.copy')"
            />
            <Button
              v-if="
                state.phase === 'result' && state.output && !state.isExternal
              "
              class="command-run-more"
              variant="neutral"
              @click="openActions"
            >
              {{ t('common.more') }}
            </Button>
            <Button class="command-run-close" variant="primary" @click="cancel">
              {{ t('common.close') }}
            </Button>
          </template>
        </div>
      </template>
    </ActionOverlayLayout>
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import AppIcon from '../components/common/AppIcon.vue'
import Button from '../components/common/Button.vue'
import ContentPadding from '../components/common/ContentPadding.vue'
import CopyButton from '../components/common/CopyButton.vue'
import FieldTextArea from '../components/common/FieldTextArea.vue'
import StateMessage from '../components/common/StateMessage.vue'
import TextPreview from '../components/common/TextPreview.vue'
import ActionOverlayLayout from '../components/overlay/ActionOverlayLayout.vue'
import { useI18n } from '../composables/use-i18n'
import { useCommandRunStore } from '../stores/command-run'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'

const { t } = useI18n()
const store = useCommandRunStore()
const menuModalsStore = useMenuModalsStore()

useNavPanelStore().resetNavPanelState({ panelVisible: false })

const state = computed(() => store.state)
const isActive = computed(() =>
  ['access', 'input', 'running'].includes(state.value.phase)
)
const title = computed(() =>
  state.value.phase === 'access'
    ? t('externalAccess.title')
    : state.value.commandName
)

const inputText = ref('')
// each run asks anew
watch(
  () => state.value.jobId,
  () => {
    inputText.value = ''
  }
)

const cancel = () => {
  void store.cancel()
}
const submit = () => {
  void store.submitText(inputText.value)
}
const onInputKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault()
    submit()
  }
}

/** The action menu on the result, as a command shown in the menu had it */
const openActions = () => {
  const { output, sourceText } = state.value
  if (!output) return
  menuModalsStore.nextModal(MenuModals.PREVIEW, {
    text: output,
    sourceText: sourceText ?? '',
  })
}
</script>

<style scoped>
.command-run-message {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-sm);
  flex: 1;
  padding: var(--space-xl);
  text-align: center;
}

.command-run-access-icon {
  color: var(--color-warning);
}

.command-run-text {
  max-width: 36rem;
  font-size: var(--text-title);
  line-height: 1.5;
}

.command-run-note {
  max-width: 36rem;
  font-size: var(--text-control);
  color: var(--app-text-muted);
}

.command-run-input {
  display: flex;
  flex: 1;
  min-height: 0;
  padding: var(--space-md);
}

.command-run-input-field {
  flex: 1;
}

.command-run-state {
  flex: 1;
}

.command-run-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-sm);
}
</style>
