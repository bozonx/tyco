import assert from 'node:assert/strict'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import prettier from 'prettier'

const root = resolve(import.meta.dirname, '..')
const directory = resolve(root, 'src-tauri/src/commands')
/** @param {string} value */
const camelCase = (value) =>
  value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())

// The aliases name shared DTOs; parameter and return shapes come from Rust.
/** @type {Record<string, string>} */
const aliases = {
  DesktopSnapshot: 'DesktopSnapshot',
  SessionState: 'SessionState',
  StorageInfo: 'StorageInfo',
  StorageKind: 'StorageKind',
  Chat: 'Chat',
  ChatSummary: 'ChatSummary',
  ChatImage: 'ChatImage',
  ChatAttachment: 'ChatAttachment',
  EditorHistoryRecord: 'EditorHistoryItem',
  CreateEditorHistoryRequest: 'EditorHistoryEntry',
  ApplyHotkeyRequest: 'HotkeyApplyRequest',
  ApplyHotkeyResult: 'HotkeyApplyResult',
  HotkeyProviderInfo: 'HotkeyProviderInfo',
  InputRegion: 'InputRect',
  OverlayRequest: 'StatusOverlayRequest',
  SelectionFinishStatus: 'SelectionFinishStatus',
  FetchRequest: 'FetchRequest',
  SocketRequest: 'SocketRequest',
  VoiceCaptureInfo: 'VoiceCaptureInfo',
  SecretStatus: 'SecretStatus',
  VaultState: 'VaultState',
  ScriptActionRequest: 'ScriptActionRequest',
  ScriptExecutionResult: 'ScriptExecutionResult',
  CommandRunRecord: 'CommandRunRecord',
  ToolCatalogEntry: 'ToolCatalogEntry',
  AccessDecision: 'AccessDecision',
  JobCompletion: 'JobCompletion',
  Job: 'ExternalJob',
  PluginPreview: 'PluginPackagePreview',
  InstalledPlugin: 'InstalledPluginPackage',
  PluginManifest: 'PluginManifest',
  AiProfile: 'AiProfile',
  AiProject: 'AiProject',
  FileRoot: 'AiFileRoot',
  FileToolRequest: 'AiFileToolRequest',
  FileToolOutput: 'AiFileToolOutput',
  FileChangePreview: 'AiFileChangePreview',
}

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

const used = new Set()
/**
 * @param {string} value
 * @returns {string}
 */
function type(value) {
  value = value.trim()
  if (value === '()') return 'void'
  if (value === 'String') return 'string'
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
      case 'Map':
        return `Record<${type(args[0])}, ${type(args[1])}>`
      case 'Channel':
        used.add('DesktopChannel')
        return 'DesktopChannel'
    }
  }
  const name = value.split('::').at(-1) ?? value
  if (name === 'Value') return 'unknown'
  if (name === 'Response') return 'ArrayBuffer | number[]'
  assert.ok(aliases[name], `Unsupported Rust IPC type: ${value}`)
  used.add(aliases[name])
  return aliases[name]
}

const commands = []
for (const file of (await readdir(directory))
  .filter((name) => name.endsWith('.rs'))
  .sort()) {
  const source = await readFile(resolve(directory, file), 'utf8')
  const pattern =
    /#\[tauri::command(?:\([^\]]*\))?\]\s*pub\s+(?:async\s+)?fn\s+(\w+)\s*\(([\s\S]*?)\)\s*(?:->\s*([\s\S]*?))?\s*\{/g
  for (const match of source.matchAll(pattern)) {
    const name = match[1]
    const fields = []
    let binary = false
    for (const parameter of split(match[2])) {
      const [key, ...rest] = parameter.split(':')
      const rustType = rest.join(':').trim()
      if (
        /^(?:tauri::)?(?:AppHandle|WebviewWindow)$/.test(rustType) ||
        /^State</.test(rustType)
      )
        continue
      if (/^(?:tauri::ipc::)?Request</.test(rustType)) {
        binary = true
        continue
      }
      assert.ok(rustType, `Invalid parameter in ${name}: ${parameter}`)
      let fieldType = type(rustType)
      // JSON configuration is intentionally extensible, but UI callers use its known schema.
      if (
        name === 'save_user_config' &&
        ['user_config', 'base_config'].includes(key)
      ) {
        used.add('UserConfig')
        fieldType = 'UserConfig'
      }
      if (name === 'patch_session_state' && key === 'patch') {
        used.add('SessionState')
        fieldType = 'Partial<SessionState>'
      }
      const optional = /^(?:[\w:]+::)?Option</.test(rustType) ? '?' : ''
      fields.push(`${camelCase(key.trim())}${optional}: ${fieldType}`)
    }
    let result = type(match[3] ?? '()')
    if (name === 'get_user_config') {
      used.add('UserConfig')
      result = 'UserConfig'
    }
    commands.push({
      name,
      args: binary
        ? 'Uint8Array'
        : fields.length
          ? `{ ${fields.join('; ')} }`
          : 'undefined',
      result,
    })
  }
}
commands.sort((a, b) => a.name.localeCompare(b.name))
const sharedTypes = [...used]
  .filter((name) => !['PluginManifest'].includes(name))
  .sort()
let output = `// Generated from src-tauri/src/commands by scripts/generate-desktop-commands.mjs.\n// Do not edit: run pnpm generate:desktop.\nimport type { ${sharedTypes.join(', ')} } from './index'\nimport type { PluginManifest } from '@tyco/plugin-sdk'\n\n`
output +=
  'export const DESKTOP_COMMANDS = {\n' +
  commands.map(({ name }) => `  ${name.toUpperCase()}: '${name}',`).join('\n') +
  '\n} as const\n\n'
output +=
  'export interface DesktopCommands {\n' +
  commands
    .map(
      ({ name, args, result }) =>
        `  ${name}: { args: ${args}; result: ${result} }`
    )
    .join('\n') +
  '\n}\n\n'
output += `export type DesktopCommandName = keyof DesktopCommands\nexport type DesktopCommandArgs<K extends DesktopCommandName> = DesktopCommands[K]['args']\nexport type DesktopCommandResult<K extends DesktopCommandName> = DesktopCommands[K]['result']\nexport type DesktopInvokeArgs<K extends DesktopCommandName> = DesktopCommandArgs<K> extends undefined ? [args?: undefined] : [args: DesktopCommandArgs<K>]\nexport type DesktopInvoke = <K extends DesktopCommandName>(command: K, ...args: [...DesktopInvokeArgs<K>, options?: { headers: Record<string, string> }]) => Promise<DesktopCommandResult<K>>\n`
output = await prettier.format(output, {
  ...(await prettier.resolveConfig(
    resolve(root, 'packages/shared/src/desktop-commands.ts')
  )),
  parser: 'typescript',
})
const destination = resolve(root, 'packages/shared/src/desktop-commands.ts')
if (process.argv.includes('--check')) {
  assert.ok(
    (await readFile(destination, 'utf8')) === output,
    'Desktop command bindings are stale; run pnpm generate:desktop'
  )
} else await writeFile(destination, output)
console.log(
  `Desktop command bindings ${process.argv.includes('--check') ? 'verified' : 'generated'}: ${commands.length}`
)
