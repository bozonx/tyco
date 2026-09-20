<template>
  <ContentPadding>
    <Editor v-if="ipcStore.params">
      <div class="mt-4 flex flex-row gap-2 text-xs">
        <RouterLink :to="APP_ROUTES.WRITE.path">{{
          t('mode.write')
        }}</RouterLink>
        <RouterLink :to="APP_ROUTES.VOICE.path">{{
          t('mode.voice')
        }}</RouterLink>
        <RouterLink :to="APP_ROUTES.AI_TASKS.path">{{
          t('mode.aiTasks')
        }}</RouterLink>
        <RouterLink :to="APP_ROUTES.SELECT.path">{{
          t('mode.select')
        }}</RouterLink>
      </div>
    </Editor>
  </ContentPadding>
</template>

<script setup lang="ts">
/**
 * Quick input panel. Unlike the routed views it stays mounted for the whole
 * lifetime of the app and is only toggled with `v-show`, so the input field and
 * its focus survive between hotkey activations. Activation side effects live in
 * `useQuickPanelStore`, because there is no mount to hang them on.
 */
import { useI18n } from '../composables/useI18n'
import { APP_ROUTES } from '../lib/navigation/routes'
import { useIpcStore } from '../stores/ipc'

const ipcStore = useIpcStore()
const { t } = useI18n()
</script>
