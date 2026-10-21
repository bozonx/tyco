# Plugin packages

TyCo's bundled plugins use the same framework-independent SDK and package format
as locally installed extensions. Bundled plugins are trusted application code and
run in the host realm; their synchronous work is not isolated by worker timeouts.
External packages run in a dedicated Worker on
a per-plugin origin. The worker has no app IPC, DOM, network, `eval`, or child
workers. A message port exposes only the declared host services. The browser can
terminate a worker that times out. This limits damage within the webview; users
still need to trust code they install because code can misuse the capabilities
they grant and the host operating system may have runtime vulnerabilities.

## Ownership and boundaries

- `packages/plugin-sdk`: public contracts, portable errors and pure utilities.
  No Vue, Pinia, application types, navigation internals or Tauri dependencies.
- `packages/plugin-build`: the `tyco-plugin-build` CLI and offline icon bundling.
- `packages/plugin-*`: a plugin's manifest, implementation, locales, dependencies
  and tests. Plugins import the SDK and their own dependencies only. ESLint
  enforces this boundary.
- `apps/desktop-ui/src/lib/plugins`: host adapters, settings normalization,
  lifecycle management, scoped resources and installed-package loading.
- `src-tauri/src/services/plugins.rs`: bounded package inspection, atomic
  installation, listing, removal and serving installed entry points.

The host owns editor state, UI rendering, command execution, persistence and OS
services. Plugin-specific text transforms, formatting parsers, templates and
translations belong to their plugin. Backend note writing remains a host service;
plugins never need Rust binaries just to use this service.

## Authoring

A factory default-exports a `PluginDefinition` from `@tyco/plugin-sdk`:

```ts
import type { PluginDefinition } from '@tyco/plugin-sdk'

export default function plugin(): PluginDefinition {
  return {
    id: 'Example',
    version: '1.0.0',
    apiVersion: 2,
    capabilities: ['editor'],
    defaultLocale: 'en_US',
    locales: {
      en_US: { label: 'Example', transform: 'Transform text' },
      ru_RU: { label: 'Example', transform: 'Transform text' },
      es_AR: { label: 'Example', transform: 'Transform text' },
      tr_TR: { label: 'Example', transform: 'Transform text' },
    },
    labelKey: 'local.label',
    init(ctx) {
      ctx.registerCaseItems([
        {
          id: 'transform',
          labelKey: 'local.transform',
          action: (text) => text.toUpperCase(),
        },
      ])
    },
  }
}
```

Plugin IDs and tool IDs are immutable and distinct from translated labels.
Existing IDs such as `Diacritics` and `FastNote.write` are current contract
identities. Plugin settings are keyed only by the current plugin ID; the plugin
SDK does not support identity aliases or executable schema-version callbacks.
Settings migrations use the declarative versioned rename chain described below.
Changing an ID starts a new plugin identity.

Use `local.*` for plugin-owned messages. The host namespaces these keys in metadata,
settings, contributions, tool results and portable `PluginError` instances. Common
host notification keys such as `toast.textNotSelected` and `toast.commandFailed`
are also supported. `ctx.t` translates plugin messages; `ctx.toastText` accepts
already resolved text. A package must include complete dictionaries for `en_US`, `ru_RU`, `es_AR`, and
`tr_TR`. Keys, value types, and placeholders must match across all dictionaries.
Missing translations are rejected; the host never falls back to another locale.

Toolbar/edit/action IDs are local to the plugin and are scoped by the host. Tool
IDs become `<pluginId>.<toolId>`. Duplicate registrations are rejected. Registration methods return an idempotent
function that removes only that registration; disposing a registration releases its
IDs for reuse. Await the returned disposer before re-registering the same IDs
from an external worker. Host UI registries store the plugin owner explicitly. Contributions
are sorted by optional numeric `order`, then plugin ID; registration order within
a plugin is preserved for ties. Async activation therefore cannot reorder plugins. Icons are
bundled offline from literal `mdi:*` references and registered under a plugin-owned
prefix so one package cannot overwrite another package's icons. Plugin collections
live in an owned reactive registry, outside Iconify's permanent global cache.
Updating replaces the entire collection; removing releases it.

Declare dependencies in the plugin's own `package.json`. Source imports use `.js`
extensions so TypeScript output also runs as standard ESM outside the monorepo.
Compiler configs are standalone. The package build runs TypeScript and
`tyco-plugin-build` (a dev dependency on `@tyco/plugin-build`). It emits:

- `dist/index.js` and declarations: ordinary ESM with declared dependencies.
- `dist/host.js`: ordinary ESM plus the plugin's offline icons; used by bundled
  plugins so the application's bundler can retain lazy parser chunks.
- `dist/plugin.js`: a standalone ESM bundle with no external dependencies.
- `dist/plugin.tyco-plugin`: format-versioned JSON containing a strictly
  validated declarative manifest and standalone module.

The initial format supports code, JSON data, dictionaries, icons and assets that
the bundler can inline. Builds reject additional chunks, external imports and
separate CSS files instead of producing a package with missing resources.

`pnpm dev` builds dependencies first and watches package TypeScript output.
Re-run `pnpm build:plugins` when adding new icons so offline icon collections are
regenerated. `pnpm dev:ui`, `pnpm build:ui` and `pnpm test:ui` build plugin
dependencies automatically.

`pnpm check:plugins` imports every packaged artifact from a fresh temporary
directory without `node_modules`; it also executes the XML formatter. The
Chromium integration check `pnpm test:plugin-runtime` runs all packaged plugins
in their isolated workers and checks network/eval blocking and worker termination.

## Settings and lifetime

The host reads saved settings only under the current plugin ID, validates declared
field types and options, and applies defaults. Unknown fields are not passed to
the plugin. `getMyConfig` returns a detached copy; plugins never receive global
user config. `enabled` is host metadata. Draft edits take effect when saved.

Activation may be async and can return a cleanup function. Use `ctx.onDispose` for
subscriptions and timers, and observe `ctx.signal` for ongoing work. Disabling,
removing or updating a plugin aborts its lifetime and removes all its contributions.
Only plugins whose effective settings or package revision changed are restarted.
An activation failure rolls back partial registrations without stopping other
plugins. A late async activation cannot register after disposal; its returned
cleanup is still called. Tool execution combines the caller's cancellation signal
with the plugin lifetime and suppresses cancelled output. Cancellation gives an
external worker 1.5 seconds to finish its current callback; an uncooperative worker
is terminated and marked failed. Cancellation of queued invocations is remembered.
Cleanup handlers run in reverse order. A throwing or asynchronously stalled handler
does not skip the rest: host handlers have individual deadlines, and worker handlers
share a bounded cleanup budget. The host closes the sandbox even when worker cleanup
cannot complete. Synchronous infinite loops in bundled code cannot be interrupted.

Background SDK calls from timers and subscriptions are accepted after successful
initialization and stop with the plugin lifetime. Invalid or expired host calls
receive explicit errors. Host and worker share the wire codec and service names
from `@tyco/plugin-sdk/runtime`: dates and callback references round-trip in both
directions. RPC values are limited to 8 MiB, 32 nesting levels and 100,000 entries;
each direction permits at most 64 unresolved requests and 4,096 callback references.
Background translation snapshots update when the host locale changes. Host service calls time out
after 10 seconds.

Plugins can call browser and note services only when they declare the corresponding
`browser` or `notes` capabilities; editor access requires `editor`. Public services
must stay typed, narrow and independent of internal stores. Add a host adapter and
SDK contract when a genuinely reusable capability is needed.

For delayed editor mutations, use `getEditorInputSnapshot()` followed by
`applyEditorInputEdit(snapshot, text, 'selection' | 'document')`. The host compares
the document, selection and revision atomically and returns `false` on a conflict;
do not retry with an unconditional setter. Revisions also detect changes that were
subsequently undone. Toolbar tools receive the same snapshot used to capture their
input in `ToolCall.editorSnapshot`. FastNote clears only the saved selection when
there is one, and preserves subsequent edits while the file is being written.

The `notes` capability does not grant arbitrary filesystem writes. Declare a text
setting with an empty default and name it using `notesDirectoryField` (the legacy
default is `pathToNotes`). The user must save a directory in that setting or in an
enabled command's corresponding tool setting. The Rust `write_plugin_note` command
binds the request to the host-selected plugin identity and reads authorized roots
from persisted settings; runtime arguments cannot grant another root. Subfolders
are supported, parent traversal and descendant symlinks are rejected, and only
regular files can be appended. Plugin defaults, presets and default commands
cannot pre-authorize a directory. Existing SDK `saveNote` and `appendNote` calls
use this scoped service through the host adapter.

## Local installation

Settings → Plugins → Install plugin package opens the native file picker. Inspection
validates the manifest and size without evaluating code. The UI shows the package
identity/version and requires an explicit trust-and-install action. A package
cannot replace a bundled plugin through this UI. Installing the same external ID
updates it; a new native revision invalidates the ESM module cache.

Installed packages live under the app data directory's `plugins` folder. Removal
unloads contributions in both windows, but retains saved settings and user commands
so reinstalling can restore them. Their tools are unavailable while the package is
absent. Changes propagate through the `plugins-changed` desktop event.

The `tyco-plugin` protocol serves only a package's current JavaScript entry
point and the fixed runtime assets. Each package runs from its own local origin.
The Worker response policy blocks connections, inline code, evaluation, and child
workers. The webview CSP permits frames from this local scheme; the development
override adds only the dev-server origins needed by the app. Runtime calls pass
through a typed, capability-checked RPC adapter.

Native inspection accepts package format 1 and plugin API 2, numeric semantic
versions, known unique capabilities, safe icons and bounded UTF-8 JSON packages
(32 MiB maximum). User settings support declarative versioned field renames. Revisions
retain one prior package so a failed update can be restored. Runtime status is
visible in plugin settings. A corrupt installed package is logged and skipped
without preventing startup.

Both native and SDK manifest validators run the shared cases in
`packages/plugin-sdk/src/test-fixtures/manifests.json`. `pnpm test:tooling` also
connects the production worker to the actual host RPC adapter to cover background
calls, cooperative and uncooperative cancellation, and cleanup failures; the
Chromium check separately verifies worker isolation under CSP.

## UI contributions and execution

Prefer declarative toolbar tool references for operations also used by commands:

```ts
ctx.registerTools([search])
const removeButton = ctx.registerToolbarItems([
  {
    id: 'search',
    toolId: search.id,
    tooltipKey: 'local.label',
    position: 'right',
  },
])
```

`toolId` is local to the plugin. The host captures an editor snapshot and uses the
same invoker as commands, including input parsing, validation, plugin config,
cancellation and portable error handling. A missing tool is unavailable. Toolbar
results report notifications and keep output handling within the tool; they do not
implicitly paste text or close the window. `toolId` and `action` are mutually
exclusive. Callback buttons remain supported for editor-specific interactions.
The SDK `runToolFromToolbar` helper remains compatible and shares the input resolver.

UI callbacks drop repeated clicks while running. Their running state disables the
button; cancellation is silent, and other errors are logged and reported. Explicit
command runs retain their own invocation lifetimes. Registration metadata and
callback results are validated at runtime, including for installed JavaScript.

Plugin action and edit registrations require stable local IDs. Prefer `labelKey`
for localized labels and `label` for literal text. `name` remains accepted at the
compatibility boundary for older plugins.

## Settings schema versions

A plugin may declare `defaultConfig.version` and a complete `migrations` array,
starting at version 0. Each step contains `fromVersion` and a `rename` map:

```ts
defaultConfig: {
  version: 1,
  migrations: [{ fromVersion: 0, rename: { oldMode: 'mode' } }],
  fields: [{ type: 'text', name: 'mode', defaultValue: '' }],
}
```

The host migrates a detached copy before validating fields and applies defaults
only afterwards. Saving settings persists `settingsVersion` beside `settings`.
Existing target values win over renamed values. A downgrade cannot discard newer
settings; unsupported versions are reported and preserved. Migrations cannot
introduce values, rename plugin identities, or rename the authorized notes-directory
field. Per-command tool configuration is a separate persisted contract: keep its
field names stable. No plugin code executes during settings migration or package
inspection.
