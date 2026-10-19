// Generates the desktop IPC contract of `@tyco/shared` from the Rust sources:
//
// - `generated/desktop-types.ts`: every type that crosses the boundary, as
//   `src-tauri/src/bindings.rs` declares it with ts-rs;
// - `generated/desktop-commands.ts`: every command of `src-tauri/src/commands`
//   with its arguments and result, built on those types.
//
// `--check` verifies the commands only, without cargo; `cargo test` verifies
// the types against the hash this script writes into them. `--commands-only`
// regenerates the commands without cargo, on the types as they are.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import prettier from 'prettier'

const root = resolve(import.meta.dirname, '..')
const commandsDir = resolve(root, 'src-tauri/src/commands')
const generatedDir = resolve(root, 'packages/shared/src/generated')
const typesFile = resolve(generatedDir, 'desktop-types.ts')
const commandsFile = resolve(generatedDir, 'desktop-commands.ts')
const isCheck = process.argv.includes('--check')
const isCommandsOnly = process.argv.includes('--commands-only')
const header = [
  '// Generated from src-tauri by scripts/generate-desktop-commands.mjs.',
  '// Do not edit: run pnpm generate:desktop.',
]

/**
 * Formats until the output is stable: a doc comment rewrapped on one pass may
 * be wrapped again on the next
 *
 * @param {string} source
 */
async function format(source) {
  const options = {
    ...(await prettier.resolveConfig(commandsFile)),
    parser: 'typescript',
  }
  let formatted = await prettier.format(source, options)
  for (let pass = 0; pass < 3; pass++) {
    const next = await prettier.format(formatted, options)
    if (next === formatted) return formatted
    formatted = next
  }
  return formatted
}

/** Has the Rust test write the raw bindings and formats them. */
async function generateTypes() {
  const directory = await mkdtemp(join(tmpdir(), 'tyco-bindings-'))
  const out = join(directory, 'desktop-types.ts')
  try {
    const cargo = spawnSync(
      'cargo',
      [
        'test',
        '--manifest-path',
        resolve(root, 'src-tauri/Cargo.toml'),
        '--lib',
        '--quiet',
        'bindings::bindings_are_current',
      ],
      { stdio: 'inherit', env: { ...process.env, TYCO_BINDINGS_OUT: out } }
    )
    assert.equal(cargo.status, 0, 'The Rust bindings could not be generated')
    const raw = await readFile(out, 'utf8')
    const hash = createHash('sha256').update(raw).digest('hex')
    await writeFile(
      typesFile,
      await format([...header, `// Source hash: ${hash}`, raw].join('\n'))
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}

if (!isCheck && !isCommandsOnly) await generateTypes()

const types = await readFile(typesFile, 'utf8')
/** Names the types file exports or imports */
const knownTypes = new Set(
  Array.from(
    types.matchAll(/export (?:type|interface|const) (\w+)/g),
    (match) => match[1]
  )
)
const imports = Array.from(
  types.matchAll(/^import type \{ ([\w, ]+) \} from '([^']+)'$/gm)
)
for (const [, names] of imports)
  for (const name of names.split(', ')) knownTypes.add(name)

/** @param {string} value */
const camelCase = (value) =>
  value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())

/** Split only at top-level commas, including nested Rust generic arguments. */
/** @param {string} value */
function split(value) {
  const parts = []
  let start = 0
  let depth = 0
  for (let index = 0; index < value.length; index++) {
    if ('<(['.includes(value[index])) depth++
    if ('>)]'.includes(value[index])) depth--
    if (value[index] === ',' && depth === 0) {
      parts.push(value.slice(start, index).trim())
      start = index + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts.filter(Boolean)
}

/** Names the generated commands file refers to */
const used = new Set()

/**
 * @param {string} value
 * @returns {string}
 */
function type(value) {
  value = value.trim()
  if (value === '()') return 'void'
  if (value === 'String' || value === '&str') return 'string'
  if (value === 'bool') return 'boolean'
  if (/^(u\d+|i\d+|usize|f\d+)$/.test(value)) return 'number'
  const generic = value.match(/^(?:[\w:]+::)?(\w+)<([\s\S]*)>$/)
  if (generic) {
    const args = split(generic[2])
    switch (generic[1]) {
      case 'Result':
        return type(args[0])
      case 'Option':
        return `${type(args[0])} | null`
      case 'Vec':
        return `Array<${type(args[0])}>`
      case 'BTreeMap':
      case 'HashMap':
        return `Record<${type(args[0])}, ${type(args[1])}>`
      case 'Channel':
        return 'DesktopChannel'
    }
    assert.fail(`Unsupported generic Rust IPC type: ${value}`)
  }
  const name = value.split('::').at(-1) ?? value
  // raw bytes, see `tauri::ipc::Response`
  if (name === 'Response') return 'ArrayBuffer'
  assert.ok(
    knownTypes.has(name),
    `${name} has no TypeScript binding; derive ts_rs::TS and list it in src-tauri/src/bindings.rs`
  )
  used.add(name)
  return name
}

const commands = []
for (const file of (await readdir(commandsDir))
  .filter((name) => name.endsWith('.rs'))
  .sort()) {
  const source = await readFile(resolve(commandsDir, file), 'utf8')
  const pattern =
    /#\[tauri::command(?:\([^\]]*\))?\]\s*pub\s+(?:async\s+)?fn\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:->\s*([\s\S]*?))?\s*\{/g
  for (const match of source.matchAll(pattern)) {
    const name = match[1]
    const fields = []
    let binaryMeta = null
    for (const parameter of split(match[2])) {
      const [key, ...rest] = parameter.split(':')
      const rustType = rest.join(':').trim()
      assert.ok(rustType, `Invalid parameter in ${name}: ${parameter}`)
      if (
        /^(?:tauri::)?(?:AppHandle|WebviewWindow|Window)$/.test(rustType) ||
        /^State</.test(rustType)
      )
        continue
      assert.ok(
        !/Request</.test(rustType) || /^BinaryRequest</.test(rustType),
        `${name} reads the raw request; take a BinaryRequest instead`
      )
      const binary = rustType.match(/^BinaryRequest<(\w+)>$/)
      if (binary) {
        binaryMeta = type(binary[1])
        continue
      }
      const optional = /^(?:[\w:]+::)?Option</.test(rustType) ? '?' : ''
      fields.push(`${camelCase(key.trim())}${optional}: ${type(rustType)}`)
    }
    assert.ok(
      !binaryMeta || !fields.length,
      `${name} takes a BinaryRequest beside other arguments`
    )
    commands.push({
      name,
      args: binaryMeta
        ? `BinaryArgs<${binaryMeta}>`
        : fields.length
          ? `{ ${fields.join('; ')} }`
          : 'undefined',
      result: type(match[3] ?? '()'),
      isBinary: Boolean(binaryMeta),
      hasActivation: fields.includes('activationId: number'),
    })
  }
}
commands.sort((a, b) => a.name.localeCompare(b.name))

const typeImports = [...used].filter((name) =>
  types.includes(`export type ${name} `)
)
let output = [
  ...header,
  `import type { ${typeImports.sort().join(', ')} } from './desktop-types'`,
  ...imports.flatMap(([, names, from]) => {
    const usedNames = names.split(', ').filter((name) => used.has(name))
    return usedNames.length
      ? [`import type { ${usedNames.join(', ')} } from '${from}'`]
      : []
  }),
  '',
  '/** A channel object passed as a command argument; see `@tauri-apps/api/core` */',
  'export interface DesktopChannel {',
  '  readonly id: number',
  '}',
  '',
  '/**',
  ' * The argument of a command that takes raw bytes: `bytes` go as the body,',
  ' * `meta` beside them; see `BinaryRequest` in `src-tauri/src/ipc.rs`',
  ' */',
  'export interface BinaryArgs<M> {',
  '  bytes: Uint8Array',
  '  meta: M',
  '}',
  '',
  '/** Every command of the backend with its arguments and its result */',
  'export interface DesktopCommands {',
  ...commands.map(
    ({ name, args, result }) =>
      `  ${name}: { args: ${args}; result: ${result} }`
  ),
  '}',
  '',
  'export type DesktopCommandName = keyof DesktopCommands',
  "export type DesktopCommandArgs<K extends DesktopCommandName> = DesktopCommands[K]['args']",
  "export type DesktopCommandResult<K extends DesktopCommandName> = DesktopCommands[K]['result']",
  '',
  '/** The commands whose argument is `BinaryArgs` */',
  `export const BINARY_DESKTOP_COMMANDS = [${commands
    .filter(({ isBinary }) => isBinary)
    .map(({ name }) => `'${name}'`)
    .join(', ')}] as const satisfies readonly DesktopCommandName[]`,
  '',
  '/** The commands that act for an activation and name it by `activationId` */',
  `export const ACTIVATION_DESKTOP_COMMANDS = [${commands
    .filter(({ hasActivation }) => hasActivation)
    .map(({ name }) => `'${name}'`)
    .join(', ')}] as const satisfies readonly DesktopCommandName[]`,
  '',
].join('\n')
output = await format(output)

if (isCheck) {
  assert.ok(
    (await readFile(commandsFile, 'utf8')) === output,
    'Desktop command bindings are stale; run pnpm generate:desktop'
  )
} else await writeFile(commandsFile, output)
console.log(
  `Desktop command bindings ${isCheck ? 'verified' : 'generated'}: ${commands.length}`
)
