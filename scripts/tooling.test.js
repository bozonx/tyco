import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { findMislabeledTests } from './check-rust-test-tiers.mjs'

import { createDevConfig, parseDevPort } from './lib/dev-config.js'
import {
  cargoPackageVersion,
  updateCargoVersion,
  validateVersion,
} from './lib/version-manifests.js'

test('development ports reject ambiguous and out-of-range values', () => {
  assert.equal(parseDevPort(undefined), 3000)
  assert.equal(parseDevPort('4312'), 4312)
  for (const value of [
    '3000abc',
    '1.5',
    '0',
    '65536',
    '-1',
    ' 3000',
    '3000\n',
  ]) {
    assert.throws(() => parseDevPort(value), /PORT must/)
  }
})

test('development config only appends dev origins to production CSP', () => {
  const csp = {
    'connect-src': "'self' ipc: http://ipc.localhost",
    'script-src': "'self' 'wasm-unsafe-eval'",
    'img-src': "'self' data:",
  }
  const snapshot = { ...csp }
  assert.deepEqual(createDevConfig(csp, 4312), {
    build: { devUrl: 'http://localhost:4312' },
    app: {
      security: {
        csp: {
          'connect-src': `${csp['connect-src']} http://localhost:4312 ws://localhost:4312`,
          'script-src': `${csp['script-src']} http://localhost:4312`,
        },
      },
    },
  })
  assert.deepEqual(csp, snapshot)
})

test('versions must be complete SemVer values', () => {
  for (const value of ['1.2.3', '0.0.0', '1.2.3-rc.1+build.01']) {
    assert.equal(validateVersion(value), value)
  }
  for (const value of [
    '1.2.3garbage',
    '1.2.3\n',
    '01.2.3',
    '1.2',
    '1.2.3-01',
    '1.2.3-',
    null,
  ]) {
    assert.throws(() => validateVersion(value), /Invalid version/)
  }
})

test('Cargo synchronization only changes the package version', () => {
  const raw =
    '[dependencies]\nversion = "9.9.9"\n\n[package]\nname = "tyco"\nversion  = "0.1.0" # app\n\n[workspace]\nmembers = []\n'
  const updated = updateCargoVersion(raw, '1.2.3')
  assert.equal(cargoPackageVersion(updated).version, '1.2.3')
  assert.equal(updated, raw.replace('"0.1.0"', '"1.2.3"'))
  assert.throws(
    () => updateCargoVersion('[dependencies]\nversion = "0.1.0"\n', '1.2.3'),
    /Missing string version/
  )
  assert.throws(
    () =>
      updateCargoVersion(
        '[package]\nname = "tyco"\n[dependencies]\nversion = "0.1.0"\n',
        '1.2.3'
      ),
    /Missing string version/
  )
})

test('Rust tests with sockets or processes need the integration prefix', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'tyco-test-tiers-'))
  try {
    await mkdir(join(dir, 'src'))
    await mkdir(join(dir, 'tests'))
    await writeFile(
      join(dir, 'src', 'lib.rs'),
      [
        '#[test]',
        'fn parses() { assert!(parse("a").is_ok()); }',
        '#[tokio::test]',
        'async fn connects() { TcpStream::connect(addr).await; }',
        '#[test]',
        'fn integration_runs() { Command::new("sh").spawn(); }',
      ].join('\n')
    )
    await writeFile(
      join(dir, 'tests', 'cli.rs'),
      '#[test]\nfn round_trip() { Command::new("tyco-ctl"); }'
    )
    const problems = await findMislabeledTests(dir)
    assert.equal(problems.length, 1)
    assert.match(problems[0], /connects/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
