#!/usr/bin/env node
// Keeps the fast Rust unit suite free of real processes and sockets.
// `pnpm test:unit:rust` skips tests by the `integration_` name prefix, so a
// test that binds a socket or starts a process without it would silently run
// in the unit suite and its coverage. This check finds such tests by the
// calls in their bodies; helpers they call are not followed. Files under a
// `tests/` directory are Cargo integration targets and need no prefix.
import { readFile, readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const rustRoot = resolve(root, 'src-tauri')
const SKIPPED_DIRS = new Set(['target', 'gen', 'node_modules'])
const SIDE_EFFECTS = [
  /\b(?:Tcp|Unix)Listener::bind\b/,
  /\b(?:Tcp|Unix)Stream::connect\b/,
  /\bUdpSocket::bind\b/,
  /\bCommand::new\b/,
  /\.spawn\(\)/,
]
const TEST_ATTRIBUTE = /#\[(?:tokio::)?test(?:\([^)]*\))?\]/g

/** @param {string} dir @returns {AsyncGenerator<string>} */
async function* rustFiles(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name) && entry.name !== 'tests') {
        yield* rustFiles(resolve(dir, entry.name))
      }
    } else if (entry.name.endsWith('.rs')) {
      yield resolve(dir, entry.name)
    }
  }
}

/** Returns the body of the function whose `{` is at or after `from`. */
function functionBody(
  /** @type {string} */ source,
  /** @type {number} */ from
) {
  const open = source.indexOf('{', from)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}' && --depth === 0)
      return source.slice(open, index + 1)
  }
  return source.slice(open)
}

export async function findMislabeledTests(dir = rustRoot) {
  const problems = []
  for await (const file of rustFiles(dir)) {
    const source = await readFile(file, 'utf8')
    for (const match of source.matchAll(TEST_ATTRIBUTE)) {
      const signature = /fn\s+([a-z0-9_]+)/.exec(source.slice(match.index))
      if (!signature) continue
      const name = signature[1]
      if (name.startsWith('integration_')) continue
      const body = functionBody(source, match.index + signature.index)
      const effect = SIDE_EFFECTS.find((pattern) => pattern.test(body))
      if (effect) {
        problems.push(`${relative(root, file)}: ${name} (${effect.source})`)
      }
    }
  }
  return problems
}

if (import.meta.main) {
  const problems = await findMislabeledTests()
  if (problems.length > 0) {
    console.error(
      'Tests that start processes or use sockets need the `integration_` prefix:\n' +
        problems.map((problem) => `  ${problem}`).join('\n')
    )
    process.exit(1)
  }
  console.log('Rust test tiers are consistent.')
}
