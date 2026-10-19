// Only trusted transport code runs in the frame. Plugin code runs in a worker.
let worker
window.addEventListener('message', (event) => {
  if (
    event.source !== parent ||
    event.data !== 'tyco-plugin-connect' ||
    !event.ports[0] ||
    worker
  )
    return
  const port = event.ports[0]
  // classic: WebKitGTK loads no module worker from this scheme
  worker = new Worker(new URL('worker.js', location.href))
  worker.onmessage = (message) => port.postMessage(message.data)
  worker.onerror = () =>
    port.postMessage({
      type: 'fatal',
      error: { message: 'Plugin worker failed' },
    })
  port.onmessage = (message) => {
    if (message.data?.type === 'terminate') {
      worker.terminate()
      port.close()
    } else worker.postMessage(message.data)
  }
  port.start()
  port.postMessage({ type: 'ready' })
})
