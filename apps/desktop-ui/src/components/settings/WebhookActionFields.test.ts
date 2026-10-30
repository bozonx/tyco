import { flushPromises, mount } from '@vue/test-utils'
import type { CommandConfig } from '@tyco/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createCommand } from '../../lib/commands/command-config'
import WebhookActionFields from './WebhookActionFields.vue'

vi.mock('../../composables/use-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}))
const { toastKey, toastError, secrets, session } = vi.hoisted(() => ({
  toastKey: vi.fn(),
  toastError: vi.fn(),
  secrets: {
    secrets: {} as Record<string, { origins: string[] }>,
    setSecret: vi.fn(async () => {}),
    removeSecret: vi.fn(async () => {}),
    refreshSecrets: vi.fn(async () => {}),
  },
  session: { persist: vi.fn(async () => {}), isSaved: vi.fn(() => true) },
}))
vi.mock('../../composables/use-toast', () => ({
  default: () => ({ toastKey, toastError }),
}))
vi.mock('../../stores/secrets', () => ({ useSecretsStore: () => secrets }))
vi.mock('../../stores/settings-session', () => ({
  useSettingsSessionStore: () => session,
}))
vi.mock('../../stores/tools', async () => {
  const { testTools } = await import('../../lib/tools/testing')
  const tools = testTools()
  return { useToolsStore: () => tools }
})

const webhook = (toolConfig: Record<string, unknown> = {}): CommandConfig => ({
  ...createCommand('webhook', 'wh1'),
  name: 'Hook',
  toolConfig: {
    url: 'https://hooks.example.com/run',
    method: 'POST',
    payloadTemplate: '',
    ...toolConfig,
  },
})

const mountFields = (command: CommandConfig) =>
  mount(WebhookActionFields, {
    props: { command },
    global: { stubs: { ActionTemplateField: true, InfoTooltip: true } },
  })

const updates = (wrapper: ReturnType<typeof mountFields>) =>
  wrapper.emitted('update') ?? []

const button = (wrapper: ReturnType<typeof mountFields>, label: string) =>
  wrapper.findAll('button').find((item) => item.text() === label)!

describe('WebhookActionFields.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    secrets.secrets = {}
  })

  it('edits headers as rows', async () => {
    const wrapper = mountFields(webhook({ headers: { Accept: 'text/plain' } }))
    // the editor hands each change back, as the settings do
    await wrapper.setProps({
      onUpdate: (field: string, value: unknown) => {
        const command = wrapper.props('command')
        void wrapper.setProps({
          command: {
            ...command,
            toolConfig: { ...command.toolConfig, [field]: value },
          },
        })
      },
    } as never)
    await wrapper.get('input.header-name').setValue('Content-Type')
    await button(wrapper, 'common.add').trigger('click')
    await wrapper
      .findComponent({ name: 'IconButton' })
      .vm.$emit('click', new MouseEvent('click'))
    // the empty row stays in the editor until it gets a name
    expect(updates(wrapper)).toEqual([
      ['headers', { 'Content-Type': 'text/plain' }],
      ['headers', {}],
    ])
  })

  it('keeps a row with a repeated name in the editor only', async () => {
    const wrapper = mountFields(webhook({ headers: { Accept: 'a' } }))
    await button(wrapper, 'common.add').trigger('click')
    await wrapper.findAll('input.header-name').at(1)!.setValue('accept')
    expect(updates(wrapper)).toEqual([])
    expect(wrapper.findAll('input.header-name')).toHaveLength(2)
    expect(wrapper.text()).toContain('settings.actionWebhookHeaderDuplicate')
  })

  it('replaces a secret header value in the secret store', async () => {
    secrets.secrets = { abc: { origins: ['https://hooks.example.com'] } }
    const wrapper = mountFields(
      webhook({ headers: { Authorization: 'tyco-secret:abc' } })
    )
    await wrapper
      .get('input[aria-label="settings.actionWebhookHeaderValue"]')
      .setValue('Bearer new')
    await button(wrapper, 'common.save').trigger('click')
    await flushPromises()
    expect(secrets.setSecret).toHaveBeenCalledWith('abc', 'Bearer new', [
      'https://hooks.example.com',
    ])
    expect(updates(wrapper)).toEqual([])
  })

  it('does not add a second empty header', async () => {
    const wrapper = mountFields(webhook({ headers: { '': '' } }))
    await button(wrapper, 'common.add').trigger('click')
    expect(updates(wrapper)).toEqual([])
  })

  it('hides a secret header value', () => {
    const wrapper = mountFields(
      webhook({ headers: { Authorization: 'tyco-secret:abc' } })
    )
    const value = wrapper.get(
      'input[aria-label="settings.actionWebhookHeaderValue"]'
    )
    expect(value.attributes('type')).toBe('password')
    expect((value.element as HTMLInputElement).value).toBe('')
  })

  it('stores a new credential bound to the webhook origin', async () => {
    const wrapper = mountFields(webhook())
    const auth = wrapper.findAll('input[type="password"]').at(-1)!
    await auth.setValue(' token ')
    await button(wrapper, 'common.save').trigger('click')
    await flushPromises()
    expect(secrets.setSecret).toHaveBeenCalledWith(
      expect.stringMatching(/^webhook/),
      'token',
      ['https://hooks.example.com']
    )
    expect(updates(wrapper).map(([field]) => field)).toEqual([
      'authSecretId',
      'isAuthEnabled',
    ])
  })

  it('refuses a credential for an invalid URL', async () => {
    const wrapper = mountFields(webhook({ url: 'not a url' }))
    await wrapper.findAll('input[type="password"]').at(-1)!.setValue('token')
    await button(wrapper, 'common.save').trigger('click')
    await flushPromises()
    expect(toastKey).toHaveBeenCalledWith('settings.invalidBaseUrl', 'error')
    expect(secrets.setSecret).not.toHaveBeenCalled()
  })

  it('warns about a credential bound to another origin and removes it', async () => {
    secrets.secrets = { 'webhook-1': { origins: ['https://old.example.com'] } }
    const wrapper = mountFields(
      webhook({ isAuthEnabled: true, authSecretId: 'webhook-1' })
    )
    expect(secrets.refreshSecrets).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('settings.apiKeyBoundTo')
    await button(wrapper, 'common.remove').trigger('click')
    await flushPromises()
    expect(updates(wrapper)).toEqual([
      ['isAuthEnabled', false],
      ['authSecretId', undefined],
    ])
    expect(session.persist).toHaveBeenCalledOnce()
    expect(secrets.removeSecret).toHaveBeenCalledWith('webhook-1')
  })

  it('reports a credential that could not be stored', async () => {
    secrets.setSecret.mockRejectedValueOnce(new Error('Locked'))
    const wrapper = mountFields(webhook())
    await wrapper.findAll('input[type="password"]').at(-1)!.setValue('token')
    await button(wrapper, 'common.save').trigger('click')
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith(
      new Error('Locked'),
      'settings.keySaveFailed'
    )
  })
})
