# Plugins

Plugins add editor transforms, toolbar buttons, menu actions and tools that
commands can run. TyCo ships several plugins (TextCase, WebFormatter,
Diacritics, FastNote, SearchInInternet); you can also install your own
packages. Internals of the runtime and the package format are in
`dev_docs/plugin-packages.md`.

## Installing a package

1. Open **Settings → Plugins → Install plugin package** and choose a
   `.tyco-plugin` file.
2. TyCo checks the package without running its code and shows its name,
   version and the capabilities it asks for.
3. Confirm only if you trust the author. A plugin runs isolated, without
   network access and without access to your files, but it can misuse the
   capabilities you grant it.

Installing a package with the same id again updates it; the previous version is
kept so a failed update can be rolled back. Removing a package keeps its
settings and the commands that use it, so reinstalling restores them; until
then those commands are unavailable. A package cannot replace a built-in
plugin. A package that is broken or no longer compatible stays in the list so
you can remove it.

## Capabilities

A plugin declares what it needs:

| Capability | Gives access to                                                       |
| ---------- | --------------------------------------------------------------------- |
| `editor`   | Reading and changing the text of the editor                           |
| `browser`  | Opening a link in the system browser                                  |
| `notes`    | Appending to note files, only in the folder you chose in its settings |

A notes folder belongs to the computer it was chosen on: it is not synchronized
with the user data folder, so on another computer you choose it again.

## Writing a plugin

A plugin is a package that depends on `@tyco/plugin-sdk` and default-exports a
factory returning a `PluginDefinition`:

```ts
import type { PluginDefinition } from '@tyco/plugin-sdk'

export default function plugin(): PluginDefinition {
  return {
    id: 'Example',
    version: '1.0.0',
    apiVersion: 2,
    capabilities: ['editor'],
    defaultLocale: 'en-US',
    locales: {
      'en-US': { label: 'Example', transform: 'Transform text' },
      'ru-RU': { label: 'Пример', transform: 'Преобразовать текст' },
      // …one dictionary for every supported locale
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

Rules to keep in mind:

- **Ids are permanent.** The plugin id and the ids of its tools identify the
  plugin and its saved settings; changing one makes a new plugin.
- **Every locale is required.** Supply a dictionary for each locale of
  `packages/plugin-sdk/src/locales.json`, with the same keys and placeholders.
  There is no fallback to another language; a package with a missing
  translation is refused. Messages use vue-i18n syntax (a literal brace is
  `{'{'}`).
- **What you can register:** case, format and edit items (they get the
  selection, or the whole text when nothing is selected; mark an item
  `selectionOnly` when the whole text would be a surprise), toolbar buttons,
  action-menu items and tools. A tool can be put on the toolbar by its id and
  used by the user's commands.
- **Settings are declarative.** Describe fields in `defaultConfig`; TyCo draws
  the form, applies defaults and gives the plugin only its own validated
  settings. Fields can be shown conditionally (`visibleWhen`), filled by
  presets, renamed between versions (`migrations`), and previewed by a tool's
  `previewConfig`.
- **Delayed edits.** For work that finishes later, take
  `getEditorInputSnapshot()` and apply the result with `applyEditorInputEdit`;
  it returns `false` if the user changed the text meanwhile. Do not overwrite
  the text unconditionally.
- **Clean up.** Use `ctx.onDispose` for timers and subscriptions and watch
  `ctx.signal`: a plugin is stopped when it is disabled, updated or removed.
- **Icons** are `mdi:*` names; they are bundled into the package, nothing is
  loaded from the network.

Build with `tsc` followed by `tyco-plugin-build` (from `@tyco/plugin-build`).
The build writes `dist/plugin.tyco-plugin`, the file to install. Everything
must be bundled into one module: extra chunks, external imports and separate
CSS files are refused. The plugins in `packages/plugin-*` are working examples.
