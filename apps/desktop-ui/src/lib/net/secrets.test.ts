import { describe, expect, it } from 'vitest'

import { llmSecretId } from '@tyco/shared'

import { createFakeNetIpc } from './fake-net-ipc'
import { createSecretKeyProvider, createSecretsClient } from './secrets'

describe('secrets', () => {
  const status = async () => ({
    'llm.google': {
      origins: ['https://generativelanguage.googleapis.com'],
      available: true,
    },
  })

  it('hands out a reference, never a key', async () => {
    const keys = createSecretKeyProvider(status, llmSecretId)

    await expect(keys.get('google')).resolves.toBe('tyco-secret:llm.google')
  })

  it('refuses a key the keychain cannot give out now', async () => {
    const keys = createSecretKeyProvider(
      async () => ({
        'llm.google': {
          origins: ['https://generativelanguage.googleapis.com'],
          available: false,
        },
      }),
      llmSecretId
    )

    await expect(keys.get('google')).rejects.toThrow(
      'locked or missing system keychain'
    )
  })

  it('lets a keyless provider through with an empty key', async () => {
    const keys = createSecretKeyProvider(status, llmSecretId)

    await expect(keys.get('openai-compatible')).resolves.toBe('')
  })

  it('refuses a provider with no stored key', async () => {
    const keys = createSecretKeyProvider(status, llmSecretId)

    await expect(keys.get('deepseek')).rejects.toThrow(
      'No API key configured for provider "deepseek"'
    )
  })

  it('does not treat object prototype names as stored keys', async () => {
    const keys = createSecretKeyProvider(status, llmSecretId)

    await expect(keys.get('toString')).rejects.toThrow()
  })

  it('maps the client to the secrets commands', async () => {
    const fake = createFakeNetIpc()
    const client = createSecretsClient(fake.ipc)

    await client.set('deepseek', 'sk-1')
    await client.set('openai-compatible', 'k', ['http://localhost:11434'])
    await client.remove('deepseek')
    await client.status()
    await client.vaultState()

    expect(fake.calls.map(({ command, args }) => [command, args])).toEqual([
      ['set_secret', { id: 'deepseek', value: 'sk-1', origins: null }],
      [
        'set_secret',
        {
          id: 'openai-compatible',
          value: 'k',
          origins: ['http://localhost:11434'],
        },
      ],
      ['delete_secret', { id: 'deepseek' }],
      ['get_secret_statuses', undefined],
      ['get_secret_vault_state', undefined],
    ])
  })
})
