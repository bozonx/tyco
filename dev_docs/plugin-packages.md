# Plugin packages

TyCo's bundled plugins use the same framework-independent SDK and package format
as locally installed extensions. The runtime currently supports **trusted
JavaScript plugins**. They execute in the application's webview and are not a
sandbox for untrusted code. Capability checks protect the SDK boundary; they do
not isolate arbitrary JavaScript or direct Tauri calls.

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
    apiVersion: 1,
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

IDs are immutable and distinct from translated labels. Existing tool IDs such as
`FastNote.write` remain stable. `Diacritics` declares `Russian Stress` as a legacy
settings ID. `legacyIds` migrates config identity; changing existing tool IDs
requires an explicit command migration rather than silently orphaning commands.

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
- `dist/plugin.tyco-plugin`: JSON containing the manifest and standalone module.

The initial format supports code, JSON data, dictionaries, icons and assets that
the bundler can inline. Builds reject additional chunks, external imports and
separate CSS files instead of producing a package with missing resources.

`pnpm dev` builds dependencies first and watches package TypeScript output.
Re-run `pnpm build:plugins` when adding new icons so offline icon collections are
regenerated. `pnpm dev:ui`, `pnpm build:ui` and `pnpm test:ui` build plugin
dependencies automatically.

`pnpm check:plugins` imports every packaged artifact from a fresh temporary
directory without `node_modules`; it also executes the XML formatter to verify
that its parser dependencies are included.

## Settings and lifetime

The host reads saved settings, resolves legacy IDs, runs `migrateConfig`, validates
field types/options, applies defaults, then runs optional `normalizeConfig`.
`getMyConfig` returns detached effective settings; no plugin receives the global
user config. `enabled` and `_configVersion` are host metadata. The settings UI
uses the same resolver. Draft edits take effect when saved, not by rebuilding the
runtime with settings from a different source.

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

A dedicated `tyco-plugin` protocol serves only installed entry points at their
current revision. It does not expose arbitrary files. The production CSP permits
this local script origin; dev uses the same policy plus the dev-server origin.
No inline scripts, network asset loading or `eval` are needed.

Native inspection accepts API version 1, numeric `major.minor.patch` versions,
known capabilities and bounded UTF-8 JSON packages (32 MiB maximum). Plugin IDs
cannot contain path separators or contribution separators. A corrupt installed
package is logged and skipped without preventing application startup.

For an untrusted plugin ecosystem, introduce an isolated runtime and RPC protocol
before claiming sandboxing. That is a separate runtime model, not something a
TypeScript interface or capability allowlist can guarantee.
