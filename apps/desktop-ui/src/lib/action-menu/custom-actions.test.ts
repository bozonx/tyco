import { describe, expect, it, vi } from 'vitest'

import type { ScriptMainAction, WebhookMainAction } from '@tyco/shared'

import type { ActionMenuDependencies } from './action-menu-store'
import {
  createScriptActionItem,
  createWebhookActionItem,
  executeWebhookAction,
} from './custom-actions'

describe('custom-actions', () => {
  describe('executeWebhookAction', () => {
    it('sends POST request with standard JSON payload', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValue({
          ok: true,
          status: 200,
          text: () => Promise.resolve('ok'),
        })

      const action: WebhookMainAction = {
        type: 'webhook',
        id: 'wh-1',
        name: 'My Webhook',
        url: 'https://api.example.com/endpoint',
      }

      await executeWebhookAction(action, 'test text', fetchFn as any)

      expect(fetchFn).toHaveBeenCalledTimes(1)
      const [url, init] = fetchFn.mock.calls[0]
      expect(url).toBe('https://api.example.com/endpoint')
      expect(init.method).toBe('POST')
      expect(init.headers['content-type']).toContain('application/json')

      const body = JSON.parse(init.body)
      expect(body.text).toBe('test text')
      expect(body.action).toBe('My Webhook')
      expect(body.source).toBe('tyco')
    })

    it('sends GET request with query parameter', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValue({
          ok: true,
          status: 200,
          text: () => Promise.resolve('ok'),
        })

      const action: WebhookMainAction = {
        type: 'webhook',
        id: 'wh-get',
        name: 'Get Hook',
        method: 'GET',
        url: 'https://api.example.com/trigger',
      }

      await executeWebhookAction(action, 'hello world', fetchFn as any)

      expect(fetchFn).toHaveBeenCalledTimes(1)
      const [url, init] = fetchFn.mock.calls[0]
      expect(url).toBe('https://api.example.com/trigger?text=hello+world')
      expect(init.method).toBe('GET')
      expect(init.body).toBeUndefined()
    })

    it('interpolates {text} into custom payload template', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValue({
          ok: true,
          status: 200,
          text: () => Promise.resolve(''),
        })

      const action: WebhookMainAction = {
        type: 'webhook',
        id: 'wh-2',
        name: 'Slack Hook',
        url: 'https://hooks.slack.com/services/xyz',
        payloadTemplate: '{"text":"{text}","channel":"#general"}',
      }

      await executeWebhookAction(action, 'hello slack', fetchFn as any)

      const [, init] = fetchFn.mock.calls[0]
      expect(init.body).toBe('{"text":"hello slack","channel":"#general"}')
    })

    it('throws error when response is not ok', async () => {
      const fetchFn = vi
        .fn()
        .mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
        })

      const action: WebhookMainAction = {
        type: 'webhook',
        id: 'wh-3',
        name: 'Failing Hook',
        url: 'https://api.example.com/fail',
      }

      await expect(
        executeWebhookAction(action, 'test', fetchFn as any)
      ).rejects.toThrow('Webhook failed with status 500')
    })
  })

  describe('createScriptActionItem', () => {
    it('warns when command is empty', async () => {
      const showToast = vi.fn()
      const saveOutput = vi.fn().mockResolvedValue(undefined)
      const executeScriptAction = vi.fn()

      const deps: Partial<ActionMenuDependencies> = {
        showToast,
        saveOutput,
        executeScriptAction,
      }

      const item: ScriptMainAction = {
        type: 'script',
        id: 's-1',
        name: 'Empty Script',
        command: '   ',
      }

      const actionItem = createScriptActionItem(item, deps as any)
      await actionItem.action('sample input')

      expect(saveOutput).toHaveBeenCalledWith('sample input')
      expect(showToast).toHaveBeenCalledWith('toast.scriptEmptyCommand', 'warn')
      expect(executeScriptAction).not.toHaveBeenCalled()
    })

    it('executes command and reports success', async () => {
      const showToast = vi.fn()
      const saveOutput = vi.fn().mockResolvedValue(undefined)
      const closeWindow = vi.fn()
      const executeScriptAction = vi
        .fn()
        .mockResolvedValue({
          success: true,
          exitCode: 0,
          stdout: 'done',
          stderr: '',
        })

      const deps: Partial<ActionMenuDependencies> = {
        showToast,
        saveOutput,
        closeWindow,
        executeScriptAction,
      }

      const item: ScriptMainAction = {
        type: 'script',
        id: 's-2',
        name: 'Echo Script',
        command: 'echo 123',
      }

      const actionItem = createScriptActionItem(item, deps as any)
      await actionItem.action('sample input')

      expect(executeScriptAction).toHaveBeenCalledWith(
        'Echo Script',
        'echo 123',
        'sample input',
        undefined
      )
      expect(showToast).toHaveBeenCalledWith('toast.scriptSuccess', 'success')
      expect(closeWindow).toHaveBeenCalled()
    })
  })

  describe('createWebhookActionItem', () => {
    it('warns when url is empty', async () => {
      const showToast = vi.fn()
      const saveOutput = vi.fn().mockResolvedValue(undefined)

      const deps: Partial<ActionMenuDependencies> = { showToast, saveOutput }

      const item: WebhookMainAction = {
        type: 'webhook',
        id: 'w-1',
        name: 'Empty Hook',
        url: '',
      }

      const actionItem = createWebhookActionItem(item, deps as any)
      await actionItem.action('sample input')

      expect(showToast).toHaveBeenCalledWith('toast.webhookEmptyUrl', 'warn')
    })
  })
})
