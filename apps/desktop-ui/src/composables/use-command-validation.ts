import { computed } from 'vue'
import { ACTION_TEXT_PLACEHOLDER, type CommandConfig } from '@tyco/shared'

import { validateCommand } from '../lib/commands/command-runtime'
import { useToolsStore } from '../stores/tools'
import { useI18n } from './use-i18n'

export function useCommandValidation(getCommand: () => CommandConfig) {
  const tools = useToolsStore()
  const { t } = useI18n()
  const issues = computed(() => validateCommand(getCommand(), tools))
  return (field: string) =>
    issues.value
      .filter((issue) => issue.field === field)
      .map((issue) =>
        t(issue.messageKey, { placeholder: ACTION_TEXT_PLACEHOLDER })
      )
}
