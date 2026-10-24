import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { Worker } from 'node:worker_threads'

import { createPluginRpc } from '../apps/desktop-ui/src/lib/plugins/plugin-rpc.ts'

const manifest = {
  id: 'Probe',
  version: '1.0.0',
  apiVersion: 2,
  capabilities: ['editor'],
  defaultLocale: 'en-US',
  locales: Object.fromEntries(
    ['en-US', 'ru-RU', 'de-DE', 'fr-FR', 'es', 'it-IT', 'pt-BR', 'pl-PL', 'tr-TR', 'uk-UA', 'cs-CZ', 'hu-HU', 'ro-RO', 'el-GR', 'hr-HR', 'ka-GE', 'kk-KZ', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR'].map((locale) => [locale, {}])
  ),
}
/** @param {string} code */
const dataUrl = (code) =>
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
/**
 * @typedef {{ action: { $callback: number } }} Contribution
 * @param {import('node:test').TestContext} t
 * @param {string} activation
 * @param {(method: string, args: unknown[]) => Promise<unknown>} [callHost]
 */
async function session(t, activation, callHost = async () => undefined) {
  const protocol = new URL(
    '../packages/plugin-sdk/src/runtime-protocol.js',
    import.meta.url
  ).href
  const source = (
    await readFile(
      new URL('../src-tauri/plugin-runtime/worker.js', import.meta.url),
      'utf8'
    )
  ).replace("'./protocol.js'", JSON.stringify(protocol))
  const worker = new Worker(
    new URL(
      dataUrl(`
    import { parentPort } from 'node:worker_threads';
    globalThis.postMessage = (value) => parentPort.postMessage(value);
    await import(${JSON.stringify(dataUrl(source))});
    parentPort.on('message', (data) => { void globalThis.onmessage({ data }); });
    parentPort.postMessage({ type: 'ready' });
  `)
    )
  )
  t.after(() => worker.terminate())
  await new Promise((resolve, reject) => {
    worker.once('message', resolve)
    worker.once('error', reject)
  })
  /** @type {Error | undefined} */
  let failure
  /** @type {Record<string, unknown>[]} */
  const events = []
  worker.on('message', (message) => events.push(message))
  /** @type {Contribution[]} */
  let registration = []
  const rpc = createPluginRpc({
    cancellationGraceMs: 250,
    timeoutMs: 2000,
    transport: {
      send: (message) => worker.postMessage(message),
      listen: (handler) => {
        worker.on('message', handler)
        return () => worker.off('message', handler)
      },
      close: () => {
        void worker.terminate()
      },
    },
    callHost: async (method, args) => {
      if (method === 'registerToolbarItems')
        registration = /** @type {Contribution[]} */ (args[0])
      return callHost(method, args)
    },
    onFailure: (error) => {
      failure = error
    },
  })
  t.after(() => rpc.close())
  await rpc.request('load', {
    manifest,
    url: dataUrl(
      `export default () => ({ ...${JSON.stringify(manifest)}, init: ${activation} })`
    ),
  })
  await rpc.request('init', { config: {}, messages: {} })
  return { rpc, events, items: registration, getFailure: () => failure }
}
function latch() {
  let resolve = () => {}
  const promise = new Promise((complete) => {
    resolve = () => complete(undefined)
  })
  return { promise, resolve }
}

test(
  'background effects after initialization reach the host and do not poison the next invocation',
  { timeout: 5000 },
  async (t) => {
    let notify = () => {}
    const notified = new Promise((resolve) => {
      notify = () => resolve(undefined)
    })
    const runtime = await session(
      t,
      `(ctx) => {
    ctx.registerToolbarItems([{ id: 'next', action: () => 'done' }]);
    setTimeout(() => ctx.toastText('background', 'info'), 10);
  }`,
      async (method) => {
        if (method === 'toastText') notify()
      }
    )
    await notified
    assert.equal(
      await runtime.rpc.request('invoke', {
        callback: runtime.items[0].action.$callback,
        args: [],
        messages: {},
      }),
      'done'
    )
  }
)

test(
  'uncooperative cancelled work terminates the worker and rejects queued calls',
  { timeout: 5000 },
  async (t) => {
    const started = latch()
    const runtime = await session(
      t,
      `(ctx) => {
    ctx.registerToolbarItems([
      { id: 'hang', action: () => { ctx.toastText('started', 'info'); return new Promise(() => {}) } },
      { id: 'next', action: () => 'done' }
    ]);
  }`,
      async (method) => {
        if (method === 'toastText') started.resolve()
      }
    )
    const controller = new AbortController()
    const running = runtime.rpc.request(
      'invoke',
      { callback: runtime.items[0].action.$callback, args: [], messages: {} },
      controller.signal
    )
    const rejected = assert.rejects(running, { code: 'tyco-plugin-cancelled' })
    await started.promise
    controller.abort()
    await rejected
    await assert.rejects(
      runtime.rpc.request('invoke', {
        callback: runtime.items[1].action.$callback,
        args: [],
        messages: {},
      }),
      /cancellation timed out/
    )
    assert.match(runtime.getFailure()?.message ?? '', /cancellation timed out/)
  }
)

test(
  'cooperative cancellation keeps the worker usable',
  { timeout: 5000 },
  async (t) => {
    const started = latch()
    const runtime = await session(
      t,
      `(ctx) => {
    ctx.registerToolbarItems([{ id: 'wait', action: (call) => new Promise((resolve) => {
      ctx.toastText('started', 'info');
      call.signal.addEventListener('abort', () => resolve('cancelled'), { once: true });
    }) }, { id: 'next', action: () => 'done' }]);
  }`,
      async (method) => {
        if (method === 'toastText') started.resolve()
      }
    )
    const controller = new AbortController()
    const running = runtime.rpc.request(
      'invoke',
      {
        callback: runtime.items[0].action.$callback,
        args: [{ $signal: true }],
        messages: {},
      },
      controller.signal
    )
    const rejected = assert.rejects(running, { code: 'tyco-plugin-cancelled' })
    await started.promise
    controller.abort()
    await rejected
    assert.equal(
      await runtime.rpc.request('invoke', {
        callback: runtime.items[1].action.$callback,
        args: [],
        messages: {},
      }),
      'done'
    )
    assert.equal(runtime.getFailure(), undefined)
  }
)

test(
  'cleanup continues after a handler throws',
  { timeout: 5000 },
  async (t) => {
    const runtime = await session(
      t,
      `(ctx) => {
    ctx.onDispose(() => { globalThis.postMessage({ type: 'probe-cleaned' }) });
    ctx.onDispose(() => { throw new Error('cleanup failed') });
    return () => {};
  }`
    )
    await runtime.rpc.request('dispose', {})
    assert.ok(runtime.events.some((event) => event.type === 'probe-cleaned'))
  }
)

test(
  'background translations receive locale changes without another invocation',
  { timeout: 5000 },
  async (t) => {
    let notified = () => {}
    const background = new Promise((resolve) => {
      notified = () => resolve(undefined)
    })
    let text
    const runtime = await session(
      t,
      `(ctx) => {
    setTimeout(() => ctx.toastText(ctx.t('local.label'), 'info'), 25);
  }`,
      async (method, args) => {
        if (method === 'toastText') {
          text = args[0]
          notified()
        }
      }
    )
    runtime.rpc.updateMessages({ local: { label: 'Updated locale' } })
    await background
    assert.equal(text, 'Updated locale')
  }
)

test(
  'cancelling a queued invocation prevents its callback from executing',
  { timeout: 5000 },
  async (t) => {
    const started = latch()
    const release = latch()
    let unwanted = false
    const runtime = await session(
      t,
      `(ctx) => {
    ctx.registerToolbarItems([
      { id: 'gate', action: async () => { await ctx.getEditorInputValue(); return 'released' } },
      { id: 'queued', action: () => ctx.toastText('unwanted', 'info') },
      { id: 'next', action: () => 'done' }
    ]);
  }`,
      async (method) => {
        if (method === 'getEditorInputValue') {
          started.resolve()
          await release.promise
        }
        if (method === 'toastText') unwanted = true
      }
    )
    const gate = runtime.rpc.request('invoke', {
      callback: runtime.items[0].action.$callback,
      args: [],
      messages: {},
    })
    await started.promise
    const controller = new AbortController()
    const cancelled = assert.rejects(
      runtime.rpc.request(
        'invoke',
        { callback: runtime.items[1].action.$callback, args: [], messages: {} },
        controller.signal
      ),
      { code: 'tyco-plugin-cancelled' }
    )
    controller.abort()
    release.resolve()
    await cancelled
    assert.equal(await gate, 'released')
    assert.equal(
      await runtime.rpc.request('invoke', {
        callback: runtime.items[2].action.$callback,
        args: [],
        messages: {},
      }),
      'done'
    )
    assert.equal(unwanted, false)
  }
)

test(
  'conditional editor edits round-trip snapshots and conflicts through the worker',
  { timeout: 5000 },
  async (t) => {
    const snapshot = {
      value: 'before selected after',
      selectedText: 'selected',
      selectionStart: 7,
      selectionEnd: 15,
      revision: 2,
    }
    let applyCount = 0
    const runtime = await session(
      t,
      `(ctx) => {
    ctx.registerToolbarItems([{ id: 'edit', action: async () => {
      const snapshot = await ctx.getEditorInputSnapshot();
      return ctx.applyEditorInputEdit(snapshot, 'new', 'selection');
    } }]);
  }`,
      async (method, args) => {
        if (method === 'getEditorInputSnapshot') return snapshot
        if (method === 'applyEditorInputEdit') {
          assert.deepEqual(args, [snapshot, 'new', 'selection'])
          return ++applyCount === 1
        }
        return undefined
      }
    )
    const invoke = () =>
      runtime.rpc.request('invoke', {
        callback: runtime.items[0].action.$callback,
        args: [],
        messages: {},
      })
    assert.equal(await invoke(), true)
    assert.equal(await invoke(), false)
    assert.equal(runtime.getFailure(), undefined)
  }
)

test(
  'cleanup continues after an asynchronous handler never settles',
  { timeout: 5000 },
  async (t) => {
    const runtime = await session(
      t,
      `(ctx) => {
    ctx.onDispose(() => globalThis.postMessage({ type: 'probe-cleaned' }));
    ctx.onDispose(() => new Promise(() => {}));
  }`
    )
    await runtime.rpc.request('dispose', {})
    assert.ok(runtime.events.some((event) => event.type === 'cleanup-error'))
    assert.ok(runtime.events.some((event) => event.type === 'probe-cleaned'))
  }
)

test(
  'worker registration returns a usable idempotent disposer',
  { timeout: 5000 },
  async (t) => {
    let disposed = 0
    const runtime = await session(
      t,
      `(ctx) => {
    const dispose = ctx.registerToolbarItems([{ id: 'temporary', action: () => {} }]);
    dispose();
    dispose();
  }`,
      async (method, args) => {
        if (method === 'registerToolbarItems') return { $callback: 1 }
        if (method === 'callback') {
          assert.deepEqual(args, [1, []])
          disposed++
        }
        return undefined
      }
    )
    assert.equal(disposed, 1)
    assert.equal(runtime.getFailure(), undefined)
  }
)
