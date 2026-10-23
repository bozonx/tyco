import type { CommandConfig } from '@tyco/shared'
import { createCommand } from '../commands/command-config'
import { messages } from '../i18n/messages'
import { getLanguageLabelKey } from '../locale/language'
import type { ToolLookup } from '../tools/tool-types'

const BUILT_IN_VOICE_PREFIX = 'builtin:voice:'

export function isBuiltInVoiceCommand(command: CommandConfig): boolean {
  return (
    (command.toolId === 'core.askInChat' &&
      command.id === `${BUILT_IN_VOICE_PREFIX}askInChat`) ||
    (command.toolId === 'core.translate' &&
      command.id ===
        `${BUILT_IN_VOICE_PREFIX}translate:${String(command.toolConfig.language)}`)
  )
}

/**
 * Runtime invocations use current core tools without changing the saved
 * library.
 */
export function createBuiltInVoiceCommands(
  tools: ToolLookup,
  t: (key: string, params?: Record<string, string | number>) => string
): CommandConfig[] {
  const chat = createCommand(
    'core.askInChat',
    `${BUILT_IN_VOICE_PREFIX}askInChat`,
    tools.get('core.askInChat')
  )
  return [
    { ...chat, name: t('tools.askInChat'), isVoiceEnabled: true },
    ...Object.keys(messages['en-US'].voiceGrammar.languages).map((language) => {
      const command = createCommand(
        'core.translate',
        `${BUILT_IN_VOICE_PREFIX}translate:${language}`,
        tools.get('core.translate')
      )
      return {
        ...command,
        name: t('tools.defaultTranslate', {
          language: t(getLanguageLabelKey(language)),
        }),
        isVoiceEnabled: true,
        toolConfig: { language },
      }
    }),
  ]
}
