import { describe, expect, it, vi } from 'vitest'
import { reactive } from 'vue'
import { createCommand } from '../commands/command-config'
import { messages } from '../i18n/messages'
import { testTools } from '../tools/testing'
import { createBuiltInVoiceCommands } from './built-in-voice-commands'
import { createVoiceCommandModel } from './voice-command-model'
import { compileVoiceRoutes, resolveVoice } from './voice-resolver'

const tools = testTools()
const textTool = tools.get('script')!
const coreTools = {
  get: () => ({
    ...textTool,
    inputSchemaFor: undefined,
    inputSchema: {
      type: 'object' as const,
      properties: { text: { type: 'string' as const } },
      required: ['text'],
    },
  }),
}
const t = (key: string) => key

describe('built-in voice commands', () => {
  it('provides only chat and translation without modifying the library', () => {
    const commands = createBuiltInVoiceCommands(coreTools, t)
    expect(new Set(commands.map((item) => item.toolId))).toEqual(
      new Set(['core.askInChat', 'core.translate'])
    )
    expect(
      commands.every((item) => item.isEnabled && item.isVoiceEnabled)
    ).toBe(true)
    expect(new Set(commands.map((item) => item.id)).size).toBe(commands.length)
  })
  it.each(Object.entries(messages))(
    'resolves standard calls in %s without saved commands',
    (_, locale) => {
      const commands = createBuiltInVoiceCommands(coreTools, t)
      const routes = compileVoiceRoutes(commands, coreTools)
      expect(
        resolveVoice(routes, `${locale.voiceGrammar.actions.askInChat} Hello!`)
          .candidates[0]
      ).toMatchObject({ commandId: 'builtin:voice:askInChat', text: 'Hello!' })

      const firstTemplate = locale.voiceGrammar.translate.split(';')[0]!
      const lang = locale.voiceGrammar.languages['en-US'].split(';')[0]!
      const translatePhrase = firstTemplate.includes('{language}')
        ? `${firstTemplate.replace('{language}', lang)} Hello!`
        : `${firstTemplate} ${lang} Hello!`

      expect(resolveVoice(routes, translatePhrase).candidates[0]).toMatchObject(
        {
          commandId: 'builtin:voice:translate:en-US',
          parameters: { language: 'en-US' },
          text: 'Hello!',
        }
      )
    }
  )
  it('runs after final dictation with the built-in language config even with a disabled saved command', async () => {
    const saved = {
      ...createCommand('core.translate', 'saved'),
      enabled: false,
      isVoiceEnabled: false,
      toolConfig: { language: 'en-US', sourceLanguage: 'ru-RU' },
    }
    const before = structuredClone(saved)
    const run = vi.fn(async () => ({ success: true }))
    const model = createVoiceCommandModel({
      commands: () => [saved],
      builtInCommands: () => createBuiltInVoiceCommands(coreTools, t),
      tools: coreTools,
      startDictation: async () => {},
      finishDictation: async () => 'translate to English Hello!',
      cancelDictation: async () => {},
      run,
    })
    await model.start()
    await model.finish()
    expect(run).toHaveBeenCalledOnce()
    expect(model.command.value?.toolConfig).toEqual({ language: 'en-US' })
    expect(saved).toEqual(before)
  })
  it('keeps unavailable standard functions visible and rechecks availability before running', async () => {
    const availability = reactive({ reason: undefined as string | undefined })
    const lookup = {
      get: () => ({
        ...textTool,
        getUnavailableReasonKey: () => availability.reason,
      }),
    }
    const run = vi.fn(async () => ({ success: true }))
    const model = createVoiceCommandModel({
      commands: () => [],
      builtInCommands: () => createBuiltInVoiceCommands(lookup, t),
      tools: lookup,
      startDictation: async () => {},
      finishDictation: async () => 'translate to English Hello!',
      cancelDictation: async () => {},
      run,
    })
    await model.start()
    await model.finish('review')
    availability.reason = 'tools.noLlm'
    expect(model.builtInCatalog.value.length).toBeGreaterThan(1)
    expect(model.routes.value).toEqual([])
    expect(model.unavailableReason(model.command.value!)).toBe('tools.noLlm')
    await model.run()
    expect(run).not.toHaveBeenCalled()
    expect(model.inputText.value).toBe('Hello!')
  })
})
