<template>
  <div class="mt-4 flex flex-row gap-2 text-xs">
    <RouterLink :to="APP_ROUTES.WRITE.path">{{ t('mode.write') }}</RouterLink>
    <RouterLink :to="APP_ROUTES.VOICE.path">{{ t('mode.voice') }}</RouterLink>
    <RouterLink :to="APP_ROUTES.AI_TASKS.path">{{ t('mode.aiTasks') }}</RouterLink>
    <RouterLink :to="APP_ROUTES.SELECT.path">{{ t('mode.select') }}</RouterLink>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../composables/useI18n'
import { APP_ROUTES } from '../lib/navigation/routes'

const { t } = useI18n()
</script>
