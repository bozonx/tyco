<template>
  <ul v-if="issues.length" class="variable-hints">
    <li
      v-for="issue in issues"
      :key="issue.name"
      class="variable-hint"
      :data-testid="`variable-hint-${issue.name}`"
    >
      <AppIcon icon="mdi:alert-outline" size="sm" aria-hidden="true" />
      <span>
        {{
          t(
            issue.isDeclared
              ? 'variables.hintNotSet'
              : 'variables.hintNotDeclared',
            { name: issue.name }
          )
        }}
      </span>
      <InlineAction
        v-if="!issue.isDeclared && issue.canDeclare"
        @click="declare(issue.name)"
      >
        {{ t('variables.declare') }}
      </InlineAction>
      <InlineAction v-else-if="issue.isDeclared" @click="openVariables">
        {{ t('variables.setValue') }}
      </InlineAction>
    </li>
  </ul>
</template>

<script setup lang="ts">
import { computed, inject } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { SETTINGS_CONTEXT_KEY } from '../../lib/settings/settings-context'
import { addVariable } from '../../lib/variables/variables-settings'
import AppIcon from '../common/AppIcon.vue'
import InlineAction from '../common/InlineAction.vue'
import {
  BUILTIN_VARIABLES,
  variableNameIssue,
  variableReferences,
} from '@tyco/shared'

/**
 * What the `{{var:NAME}}` of `templates` need on this device: a variable that
 * is not declared, or one without a value here
 */
const props = defineProps<{ templates: readonly string[] }>()

const { t } = useI18n()
const context = inject(SETTINGS_CONTEXT_KEY, null)
const builtins: readonly string[] = BUILTIN_VARIABLES

const issues = computed(() => {
  const config = context?.draft.value
  if (!config) return []
  const names = new Set(props.templates.flatMap(variableReferences))
  return [...names].flatMap((name) => {
    if (builtins.includes(name)) return []
    const variable = config.variables.find((item) => item.name === name)
    if (variable && config.variableValues[variable.id]?.trim()) return []
    return [
      {
        name,
        isDeclared: Boolean(variable),
        canDeclare: !variableNameIssue(name, config.variables),
      },
    ]
  })
})

function declare(name: string) {
  if (context) addVariable(context.draft.value, name)
}

function openVariables() {
  context?.navigate('variables')
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
