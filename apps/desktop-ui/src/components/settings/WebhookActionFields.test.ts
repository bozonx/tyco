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
vi.mock('../../stores/operations', async () => {
  const { testOperations } = await import('../../lib/operations/testing')
  const tools = testOperations()
  return { useOperationsStore: () => tools }
})

const webhook = (
  operationConfig: Record<string, unknown> = {}
): CommandConfig => ({
  ...createCommand('webhook', 'wh1'),
  name: 'Hook',
  operationConfig: {
    url: 'https://hooks.example.com/run',
    method: 'POST',
    payloadTemplate: '',
    ...operationConfig,
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
            operationConfig: { ...command.operationConfig, [field]: value },
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
    const wrapper = mountFields(
      webhook({ headers: { Accept: 'tyco-secret:webhook.header.a' } })
    )
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

  it('stores a new value of a secret header under its id, bound to the webhook origin', async () => {
    const wrapper = mountFields(
      webhook({ headers: { Authorization: 'tyco-secret:webhook.header.a' } })
    )
    await wrapper.get('input[type="password"]').setValue(' token ')
    await button(wrapper, 'common.save').trigger('click')
    await flushPromises()
    expect(secrets.setSecret).toHaveBeenCalledWith(
      'webhook.header.a',
      'token',
      ['https://hooks.example.com']
    )
    expect(updates(wrapper)).toEqual([])
  })

  it('saves no value before the URL is valid, and says why', async () => {
    const wrapper = mountFields(
      webhook({
        url: '',
        headers: { Authorization: 'tyco-secret:webhook.header.a' },
      })
    )
    await wrapper.get('input[type="password"]').setValue('token')
    expect(button(wrapper, 'common.save').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('settings.actionWebhookHeaderNeedsUrl')
    expect(secrets.setSecret).not.toHaveBeenCalled()
  })

  it('stores the value of a new secret header and refers to it by a new id', async () => {
    const wrapper = mountFields(webhook({ headers: {} }))
    await button(wrapper, 'common.add').trigger('click')
    // a name that tells of a key makes the row secret
    await wrapper.get('input.header-name').setValue('Authorization')
    await wrapper.get('input[type="password"]').setValue('Bearer t')
    // nothing in plain text reaches the config
    expect(updates(wrapper)).toEqual([])
    expect(wrapper.text()).toContain('settings.actionWebhookHeaderUnsaved')
    await button(wrapper, 'common.save').trigger('click')
    await flushPromises()
    const [[id, value, origins]] = secrets.setSecret.mock.calls as unknown as [
      [string, string, string[]],
    ]
    expect(id).toMatch(/^webhook\.header\./)
    expect([value, origins]).toEqual([
      'Bearer t',
      ['https://hooks.example.com'],
    ])
    expect(updates(wrapper)).toEqual([
      ['headers', { Authorization: `tyco-secret:${id}` }],
    ])
  })

  it('keeps a plain value in the config, with its variables', async () => {
    const wrapper = mountFields(
      webhook({ headers: { 'X-Device': '{{var:TYCO_DEVICE_ID}}' } })
    )
    expect(wrapper.find('input[type="password"]').exists()).toBe(false)
    const field = wrapper
      .findAllComponents({ name: 'ActionTemplateField' })
      .at(-1)!
    expect(field.props('modelValue')).toBe('{{var:TYCO_DEVICE_ID}}')
    expect(field.props('canUseVariables')).toBe(true)
    field.vm.$emit('update:modelValue', 'v2')
    expect(updates(wrapper)).toEqual([['headers', { 'X-Device': 'v2' }]])
  })

  it('makes a plain value secret: it waits to be saved, out of the config', async () => {
    const wrapper = mountFields(webhook({ headers: { 'X-Key': 'plain' } }))
    await wrapper.get('[data-testid="header-secret-toggle"]').trigger('click')
    const value = wrapper.get('input[type="password"]')
    expect((value.element as HTMLInputElement).value).toBe('plain')
    expect(updates(wrapper)).toEqual([['headers', {}]])
  })

  it('makes a secret value plain and removes the stored one', async () => {
    const wrapper = mountFields(
      webhook({ headers: { 'X-Key': 'tyco-secret:webhook.header.a' } })
    )
    await wrapper.get('[data-testid="header-secret-toggle"]').trigger('click')
    await flushPromises()
    expect(updates(wrapper)).toEqual([['headers', { 'X-Key': '' }]])
    expect(secrets.removeSecret).toHaveBeenCalledWith('webhook.header.a')
  })

  it('provides info tooltips on field rows rather than input controls', () => {
    const wrapper = mount(WebhookActionFields, {
      props: { command: webhook() },
      global: { stubs: { ActionTemplateField: true } },
    })
    const fieldRows = wrapper.findAllComponents({ name: 'FieldRow' })
    expect(fieldRows[0].props('info')).toBe('settings.actionWebhookUrlInfo')
    expect(fieldRows[1].props('info')).toBe('settings.actionWebhookBodyInfo')
    expect(fieldRows[2].props('info')).toBe('settings.actionWebhookHeadersInfo')
  })

  it('warns about a secret bound to another origin and removes it with its header', async () => {
    secrets.secrets = {
      'webhook.header.a': { origins: ['https://old.example.com'] },
    }
    const wrapper = mountFields(
      webhook({ headers: { Authorization: 'tyco-secret:webhook.header.a' } })
    )
    expect(secrets.refreshSecrets).toHaveBeenCalledOnce()
    expect(wrapper.text()).toContain('settings.apiKeyBoundTo')
    await wrapper.get('button[aria-label="common.remove"]').trigger('click')
    await flushPromises()
    expect(updates(wrapper)).toEqual([['headers', {}]])
    expect(session.persist).toHaveBeenCalledOnce()
    expect(secrets.removeSecret).toHaveBeenCalledWith('webhook.header.a')
  })

  it('reports a secret value that could not be stored', async () => {
    secrets.setSecret.mockRejectedValueOnce(new Error('Locked'))
    const wrapper = mountFields(
      webhook({ headers: { Authorization: 'tyco-secret:webhook.header.a' } })
    )
    await wrapper.get('input[type="password"]').setValue('token')
    await button(wrapper, 'common.save').trigger('click')
    await flushPromises()
    expect(toastError).toHaveBeenCalledWith(
      new Error('Locked'),
      'settings.keySaveFailed'
    )
  })
})
