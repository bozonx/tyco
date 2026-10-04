<template>
  <p v-for="issue in issues" :key="issue.messageKey" class="field-issue">
    {{ t(issue.messageKey, { placeholder: TEXT }) }}
  </p>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import type { CommandIssue } from '../../lib/commands/command-config'
import { ACTION_TEXT_PLACEHOLDER as TEXT } from '@tyco/shared'

defineProps<{ issues: CommandIssue[] }>()

const { t } = useI18n()
</script>

<style scoped>
.field-issue {
  font-size: 0.75rem;
  color: var(--color-warning);
}
</style>
