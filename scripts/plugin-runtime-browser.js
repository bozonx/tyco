/* global MessageChannel */
const assert = (condition, message) => { if (!condition) throw new Error(message) }
const verified = []
async function session() {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
  iframe.src = `http://127.0.0.1:${location.port}/runtime/index.html`
  const channel = new MessageChannel()
  const tasks = new Map()
  const registrations = {}
  let sequence = 0
  let ready
  const started = new Promise((resolve) => { ready = resolve })
  channel.port1.onmessage = ({ data }) => {
    if (data.type === 'ready') { ready(); return }
    if (data.type === 'result') {
      const task = tasks.get(data.id)
      if (!task) return
      tasks.delete(data.id)
      clearTimeout(task.timer)
      if (data.error) task.reject(new Error(data.error.message))
      else task.resolve(data.result)
    } else if (data.type === 'fatal') throw new Error('Worker failed')
    else if (data.type === 'host') {
      let result
      if (data.method.startsWith('register')) registrations[data.method] = data.args[0]
      else if (data.method === 'getEditorInputValue' || data.method === 'getEditorInputSelectedText') result = 'hello'
      else if (data.method === 'callApiFunction') result = { success: true, result: '/vault/note.md' }
      channel.port1.postMessage({ type: 'host-result', id: data.id, result })
    }
  }
  iframe.onload = () => iframe.contentWindow.postMessage('tyco-plugin-connect', '*', [channel.port2])
  document.body.append(iframe)
  await started
  return {
    registrations,
    request(method, args, timeoutMs = 5000) {
      return new Promise((resolve, reject) => {
        const id = ++sequence
        tasks.set(id, { resolve, reject, timer: setTimeout(() => { tasks.delete(id); reject(new Error('Request timed out')) }, timeoutMs) })
        channel.port1.postMessage({ type: 'request', id, method, args })
      })
    },
    close() {
      channel.port1.postMessage({ type: 'terminate' })
      channel.port1.close()
      iframe.remove()
    },
  }
}
async function main() {
  const packages = await (await fetch('/packages.json')).json()
  for (const item of packages) {
    const runtime = await session()
    try {
      const { manifest } = item
      await runtime.request('load', { manifest, url: `http://127.0.0.1:${location.port}${item.url}` })
      const config = Object.fromEntries((manifest.defaultConfig?.fields ?? []).map((field) => [field.name, field.defaultValue]))
      if (manifest.id === 'FastNote') config.pathToNotes = '/vault'
      if (manifest.id === 'WebFormatter') config.language = 'xml'
      const messages = { local: manifest.locales[manifest.defaultLocale] }
      await runtime.request('init', { config, messages })
      const contribution = runtime.registrations.registerFormatItems?.[0] ?? runtime.registrations.registerCaseItems?.[0] ?? runtime.registrations.registerTools?.[0] ?? runtime.registrations.registerToolbarItems?.[0]
      assert(contribution, `No contributions: ${manifest.id}`)
      const callback = (contribution.run ?? contribution.action).$callback
      let args = contribution.run ? [{ input: { text: 'hello' }, config, source: 'external', wantsOutput: true, $signal: true }] : [manifest.id === 'WebFormatter' ? '<root><item/></root>' : 'hello']
      if (manifest.id === 'RuntimeProbe') {
        let timedOut = false
        try { await runtime.request('invoke', { callback, args: [], messages }, 150) } catch { timedOut = true }
        assert(timedOut, 'Infinite plugin blocked the host')
      } else {
        const result = await runtime.request('invoke', { callback, args, messages })
        if (manifest.id === 'WebFormatter') assert(result === '<root>\n  <item />\n</root>\n', 'Packaged formatter failed in worker')
        if (contribution.run) assert(result.ok, `Tool failed: ${manifest.id}`)
        await runtime.request('dispose', {})
      }
      verified.push(manifest.id)
    } finally { runtime.close() }
  }
  // A fresh runtime still starts after an infinite loop was terminated.
  const fresh = await session()
  fresh.close()
  verified.push('termination and restart')
}
void main().then(
  () => fetch('/result', { method: 'POST', body: JSON.stringify({ ok: true, verified }) }),
  (error) => fetch('/result', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), verified }) })
)
