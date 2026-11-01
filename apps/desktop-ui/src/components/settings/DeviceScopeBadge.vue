<template>
  <Badge tone="muted" :title="t('settings.deviceScopedHint')">
    <AppIcon icon="mdi:laptop" size="xs" />
    {{ t('settings.deviceScoped') }}
  </Badge>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import AppIcon from '../common/AppIcon.vue'
import Badge from '../common/Badge.vue'

const { t } = useI18n()
</script>
