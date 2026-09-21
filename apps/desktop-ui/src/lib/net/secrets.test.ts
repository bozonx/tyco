import { DESKTOP_COMMANDS } from '@tyco/shared'
import { describe, expect, it } from 'vitest'

import { createFakeNetIpc } from './fake-net-ipc'
import { createSecretKeyProvider, createSecretsClient } from './secrets'

describe('secrets', () => {
  const status = async () => ({
    google: { origins: ['https://generativelanguage.googleapis.com'] },
  })

  it('hands out a reference, never a key', async () => {
    const keys = createSecretKeyProvider(status)

    await expect(keys.get('google')).resolves.toBe('tyco-secret:google')
  })

  it('lets a keyless provider through with an empty key', async () => {
    const keys = createSecretKeyProvider(status)

    await expect(keys.get('openai-compatible')).resolves.toBe('')
  })

  it('refuses a provider with no stored key', async () => {
    const keys = createSecretKeyProvider(status)

    await expect(keys.get('deepseek')).rejects.toThrow(
      'No API key configured for provider "deepseek"'
    )
  })

  it('does not treat object prototype names as stored keys', async () => {
    const keys = createSecretKeyProvider(status)

    await expect(keys.get('toString')).rejects.toThrow()
  })

  it('maps the client to the secrets commands', async () => {
    const fake = createFakeNetIpc()
    const client = createSecretsClient(fake.ipc)

    await client.set('deepseek', 'sk-1')
    await client.set('openai-compatible', 'k', ['http://localhost:11434'])
    await client.remove('deepseek')
    await client.status()

    expect(fake.calls.map(({ command, args }) => [command, args])).toEqual([
      [
        DESKTOP_COMMANDS.SECRETS_SET,
        { id: 'deepseek', value: 'sk-1', origins: null },
      ],
      [
        DESKTOP_COMMANDS.SECRETS_SET,
        {
          id: 'openai-compatible',
          value: 'k',
          origins: ['http://localhost:11434'],
        },
      ],
      [DESKTOP_COMMANDS.SECRETS_REMOVE, { id: 'deepseek' }],
      [DESKTOP_COMMANDS.SECRETS_STATUS, undefined],
    ])
  })
})
