/** @param {string | undefined} value */
export function parseDevPort(value) {
  const port = value || '3000'
  if (
    port !== port.trim() ||
    !/^\d+$/.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535
  ) {
    throw new Error('PORT must be an integer between 1 and 65535')
  }
  return Number(port)
}

/**
 * @param {Record<string, string>} csp
 * @param {number} port
 */
export function createDevConfig(csp, port) {
  const origin = `http://localhost:${port}`
  return {
    build: { devUrl: origin },
    app: {
      security: {
        csp: {
          'connect-src': `${csp['connect-src']} ${origin} ws://localhost:${port}`,
          'script-src': `${csp['script-src']} ${origin}`,
        },
      },
    },
  }
}
