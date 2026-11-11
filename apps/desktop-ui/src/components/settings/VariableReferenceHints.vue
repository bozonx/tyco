<template>
  <ul v-if="issues.length" class="variable-hints">
    <li
      v-for="issue in issues"
      :key="issue.name"
      class="variable-hint"
      :data-testid="`variable-hint-${issue.name}`"
    >
      <AppIcon icon="mdi:alert-outline" size="sm" aria-hidden="true" />
      <span>{{ messageOf(issue) }}</span>
      <InlineAction
        v-if="issue.kind === 'notDeclared' && canDeclare(issue.name)"
        @click="declare(issue.name)"
      >
        {{ t('variables.declare') }}
      </InlineAction>
      <InlineAction
        v-else-if="issue.kind === 'notSet'"
        @click="context?.editVariable(issue.variableId)"
      >
        {{ t('variables.setValue') }}
      </InlineAction>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { SETTINGS_CONTEXT_KEY } from '../../lib/settings/settings-context'
import {
  type VariableReferenceIssue,
  addVariable,
  variableReferenceIssues,
} from '../../lib/variables/variables-settings'
import AppIcon from '../common/AppIcon.vue'
import InlineAction from '../common/InlineAction.vue'
import { variableNameIssue } from '@tyco/shared'

/**
 * What the `{{var:NAME}}` of `templates` need on this device: a variable that
 * is not declared, one without a value here, or a name to correct
 */
const props = defineProps<{ templates: readonly string[] }>()

const { t } = useI18n()
const context = inject(SETTINGS_CONTEXT_KEY, null)

const issues = computed(() => {
  const config = context?.draft.value
  return config ? variableReferenceIssues(props.templates, config) : []
})

function canDeclare(name: string): boolean {
  const config = context?.draft.value
  return config ? !variableNameIssue(name, config.variables) : false
}

function declare(name: string) {
  if (!context) return
  const result = addVariable(context.draft.value, name)
  if (result.ok) {
    context.editVariable(result.variable.id)
  }
}

function messageOf(issue: VariableReferenceIssue): string {
  switch (issue.kind) {
    case 'cycle':
      return t('variables.hintCycle', { name: issue.name })
    case 'notSet':
      return t('variables.hintNotSet', { name: issue.name })
    case 'notDeclared':
      return t('variables.hintNotDeclared', { name: issue.name })
    case 'invalidName':
      return t('variables.hintInvalidName', { name: issue.name })
    case 'wrongCase':
      return t('variables.hintWrongCase', {
        name: issue.name,
        expected: issue.expected,
      })
  }
}
</script>

<style scoped>
.variable-hints {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs, 0.125rem);
  margin-top: var(--space-xs);
  color: var(--app-warning, var(--app-text-muted));
  font-size: var(--text-small);
}
.variable-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-xs);
}
</style>
