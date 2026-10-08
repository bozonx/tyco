# Plugin packages

TyCo's bundled plugins use the same framework-independent SDK and package format
as locally installed extensions. External packages run in a dedicated Worker on
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
    locales: { en_US: { label: 'Example', transform: 'Transform text' } },
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
SDK does not support identity aliases, migrations, or schema-version callbacks.
Changing an ID starts a new plugin identity.

Use `local.*` for plugin-owned messages. The host namespaces these keys in metadata,
settings, contributions, tool results and portable `PluginError` instances. Common
host notification keys such as `toast.textNotSelected` and `toast.commandFailed`
are also supported. `ctx.t` translates plugin messages; `ctx.toastText` accepts
already resolved text. A package must include its default dictionary and can
provide any subset of other UI locales; missing messages fall back to its default.

Toolbar/edit/action IDs are local to the plugin and are scoped by the host. Tool
IDs become `<pluginId>.<toolId>`. Duplicate registrations are rejected. Icons are
bundled offline from literal `mdi:*` references and registered under a plugin-owned
prefix so one package cannot overwrite another package's icons.

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
with the plugin lifetime and suppresses cancelled output.

Plugins can call browser and note services only when they declare the corresponding
`browser` or `notes` capabilities; editor access requires `editor`. Public services
must stay typed, narrow and independent of internal stores. Add a host adapter and
SDK contract when a genuinely reusable capability is needed.

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
(32 MiB maximum). User settings have no plugin schema migration path. Revisions
retain one prior package so a failed update can be restored. Runtime status is
visible in plugin settings. A corrupt installed package is logged and skipped
without preventing startup.
