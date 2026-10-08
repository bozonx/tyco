import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_USER_CONFIG, type UserConfig } from '@tyco/shared'

import { PRESETS_KEYS } from '../../types'
import { createToolRegistry } from '../tools/tool-registry'
import { TEXT_INPUT_SCHEMA, type ToolDefinition } from '../tools/tool-types'
import {
  createDefaultCommandsSync,
  defaultCommandId,
  seedDefaultCommands,
} from './default-commands'

const t = (key: string, params?: Record<string, unknown>) =>
  params ? `${key}(${JSON.stringify(params)})` : key

const tool = (
  id: string,
  extra: Partial<ToolDefinition> = {}
): ToolDefinition => ({
  id,
  description: id,
  inputSchema: TEXT_INPUT_SCHEMA,
  run: async () => ({ ok: true }),
  ...extra,
})

const noteTool = tool('write', {
  defaultCommands: () => [
    {
      id: 'note',
      name: 'Note',
      phrases: ['note'],
      menu: { preferredKey: 'c' },
    },
    {
      id: 'daily',
      name: 'Daily',
      toolConfig: { saveMode: 'append' },
      menu: { preferredKey: 'd' },
    },
  ],
})

const config = (extra: Partial<UserConfig> = {}): UserConfig => ({
  ...structuredClone(DEFAULT_USER_CONFIG),
  mainActions: [],
  commands: [],
  ...extra,
})

const registry = (...plugin: ToolDefinition[]) => {
  const tools = createToolRegistry([
    tool('core.correct', {
      defaultAfterRun: 'replaceSelection',
      defaultCommands: () => [{ id: 'fix', name: 'Fix' }],
    }),
    tool('core.copy'),
  ])
  tools.registerPluginTools('Notes', plugin)
  return tools.list()
}

describe('seedDefaultCommands', () => {
  it('adds the presets of each tool once, with their settings', () => {
    const seeded = seedDefaultCommands(config(), registry(noteTool), t)!
    expect(seeded.commands.map((command) => command.id)).toEqual([
      'default:core.correct:fix',
      'default:Notes.write:note',
      'default:Notes.write:daily',
    ])
    expect(seeded.commands[0]).toMatchObject({
      name: 'Fix',
      toolId: 'core.correct',
      afterRun: 'replaceSelection',
      confirm: 'auto',
      availableIn: { external: true, chat: false },
      enabled: true,
    })
    expect(seeded.commands[2].toolConfig).toEqual({ saveMode: 'append' })
    expect(seeded.seededCommands).toEqual([
      'default:core.correct:fix',
      'default:core.correct',
      'default:Notes.write:note',
      'default:Notes.write:daily',
      'default:Notes.write',
    ])
    expect(
      seedDefaultCommands({ ...config(), ...seeded }, registry(noteTool), t)
    ).toBeNull()
  })

  it('does not bring back a deleted default command', () => {
    const userConfig = config({
      seededCommands: ['default:core.correct:fix', 'default:core.correct'],
    })
    expect(seedDefaultCommands(userConfig, registry(), t)).toBeNull()
  })

  it('seeds no command a tool adds after its first seeding', () => {
    const userConfig = config({
      seededCommands: ['default:core.correct', 'default:Notes.write'],
    })
    expect(seedDefaultCommands(userConfig, registry(noteTool), t)).toBeNull()
  })

  it('waits for a disabled plugin to be enabled', () => {
    const userConfig = config({
      seededCommands: ['default:core.correct'],
      plugins: { Notes: { enabled: false } },
    })
    expect(seedDefaultCommands(userConfig, registry(noteTool), t)).toBeNull()
  })

  it('keeps a command of the same id the user already has', () => {
    const own = {
      ...seedDefaultCommands(config(), registry(), t)!.commands[0],
      name: 'Mine',
    }
    const seeded = seedDefaultCommands(
      config({ commands: [own] }),
      registry(),
      t
    )!
    expect(seeded.commands).toEqual([own])
  })

  it('uses preferred free slots without replacing existing menu items', () => {
    const seeded = seedDefaultCommands(
      config({
        seededCommands: ['default:core.correct'],
        mainActions: [{ type: 'standard', actionId: 'insertIntoWindow' }],
      }),
      registry(noteTool),
      t
    )!
    expect(seeded.mainActions[0]).toEqual({
      type: 'standard',
      actionId: 'insertIntoWindow',
    })
    expect(seeded.mainActions[PRESETS_KEYS.indexOf('c')]).toEqual({
      type: 'command',
      commandId: defaultCommandId('Notes.write', 'note'),
    })
    expect(seeded.mainActions[PRESETS_KEYS.indexOf('d')]).toEqual({
      type: 'command',
      commandId: defaultCommandId('Notes.write', 'daily'),
    })
  })
})

describe('createDefaultCommandsSync', () => {
  it('seeds the saved config and saves it back', async () => {
    const saved: UserConfig = config({ theme: 'dark' })
    const saveUserConfig = vi.fn(async () => true)
    const sync = createDefaultCommandsSync({
      tools: () => registry(),
      loadUserConfig: async () => saved,
      saveUserConfig,
      t,
    })
    await sync.check()
    expect(saveUserConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: 'dark',
        seededCommands: ['default:core.correct:fix', 'default:core.correct'],
      })
    )
  })

  it('runs one seeding at a time and checks again after it', async () => {
    let release: () => void = () => {}
    const loadUserConfig = vi.fn(
      () =>
        new Promise<UserConfig>((resolve) => {
          release = () =>
            resolve(config({ seededCommands: ['default:core.correct'] }))
        })
    )
    const sync = createDefaultCommandsSync({
      tools: () => registry(),
      loadUserConfig,
      saveUserConfig: async () => true,
      t,
    })
    const first = sync.check()
    const second = sync.check()
    await Promise.resolve()
    expect(loadUserConfig).toHaveBeenCalledTimes(1)
    release()
    await new Promise((resolve) => setTimeout(resolve))
    release()
    await Promise.all([first, second])
    expect(loadUserConfig).toHaveBeenCalledTimes(2)
  })
})
