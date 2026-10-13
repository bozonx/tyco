# Frontend state ownership

Pinia stores are application-instance boundaries. Each Tauri webview has its
own Pinia instance; IPC events synchronize backend-owned configuration and
session state across windows. A module-level mutable singleton must not own a
session that belongs to an application instance.

SessionState is backend-owned memory shared across webviews and resets on app
restart. Persistent preferences and portable registration metadata belong to
UserConfig. See [Configuration storage](config-storage.md) for the versioned
schema, file inventory, migration, recovery and credential lifetimes.

## Ownership map

| Area                                     | Owner                                                               | Responsibility                                                                                |
| ---------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Desktop configuration and window context | ipc                                                                 | Backend snapshots, typed desktop calls, configuration saves, serialized session-state patches |
| Editor document and selection            | editor-input                                                        | Document, selection, edit source, draft persistence and focus requests                        |
| Quick writing input                      | write-input                                                         | Draft lifetime, dismissal restoration, recall and focus requests                              |
| Chat input                               | chat-input                                                          | Input text, remembered selection and one-shot caret restoration                               |
| Chat session                             | chat                                                                | Conversation, generation, context, attachments and file ownership                             |
| Microphone session                       | dictation                                                           | One live dictation per application instance; cancellation on disposal                         |
| Theme                                    | theme                                                               | Appearance derived from configuration and system preferences                                  |
| Menu stack                               | menu-modals                                                         | Modal steps, pending operations and cancellation ownership                                    |
| Navigation chrome                        | nav-panel                                                           | Page-specific visibility and Escape behavior                                                  |
| Quick window dismissal                   | quick-dismiss                                                       | Reference-counted holds while an operation needs the window                                   |
| Markdown display                         | markup-mode                                                         | Editor markup visibility                                                                      |
| Notifications                            | toast                                                               | Toast state and timer lifetime                                                                |
| Plugin registrations                     | tools, action-menu, edit-menu, toolbar                              | Reactive tool and menu registries; callback-bearing registrations use shallow refs            |
| Plugin runtime                           | plugin-runtime                                                      | Per-instance catalog, activation manager, runtime statuses and refresh queue                  |
| Settings editing                         | settings-session                                                    | Shared settings draft, debounced saves and recovery after failed navigation saves             |
| Provider services                        | llm, translation                                                    | Non-reactive clients and provider wiring; llm also owns reactive key availability             |
| Correction                               | text-correction, correction-workflow                                | Shared speculative correction and UI insertion/correction flows respectively                  |
| Execution                                | invocations, command-launcher, external-commands, selection-replace | Shared dependencies and distinct interactive/background execution lifetimes                   |
| Synchronization services                 | commands, tool-catalog                                              | Default command synchronization and publication of available tools                            |

The text-correction and correction-workflow stores intentionally have different responsibilities.
Background command execution and interactive command preparation also have
different cancellation and presentation rules. Merging these stores would
couple independent lifetimes.

## Models and adapters

Business and state transitions live in src/lib/ models with injected
persistence, transport, clocks, notifications or other runtime dependencies.
Models may use Vue reactivity but do not resolve Pinia stores themselves.
Stores wire those dependencies and register cleanup with onScopeDispose.

Keep lightweight UI-only state in its component or composable: DOM references,
temporary search queries, dropdown visibility and drag positions do not need
global stores. The settings draft is an exception: settings-session keeps failed
saves available after navigation. Promote state to Pinia when independent
consumers must share it or it must outlive the component that created it.

The useEditorNavigation composable is stateless. Transferred text is applied
directly to editor-input; there is no second route-owned copy to replay when
the editor component mounts again. Transfers from the quick window use IPC.

## Reactivity and resources

- Return every application-state ref from a setup store/model so Pinia can
  register it. Computed getters are derived state, not substitute owners.
- Keep transport clients outside deep reactivity with markRaw. Keep native
  cancellation handles in model closures instead of reactive state.
- Use actions to preserve coupled state invariants, such as resetting a stale
  selection when replacing a whole document.
- Dispose external subscriptions, manually started watchers and timers.
  Cancel active generation, speculative correction and microphone sessions.
- Remove caller abort listeners when requests settle. An obsolete caller must
  not cancel a later correction for different text.

## Asynchronous state

- Editor and chat history loads use request versions. A response from before
  deletion or clearing cannot resurrect an item in the displayed list.
- Editor history loads wait for writes already pending when loading starts.
- Session-state patches are serialized within the window. A backend state event
  received while a patch is pending takes precedence over that patch response.
- Secret availability refreshes commit status and vault state together; the
  latest refresh wins. Secret values never enter reactive application state.
- Chat generation and chat opening already use operation identities to reject
  stale completions; retain those guards when extending their flows.

The backend remains responsible for cross-window persistence and merging.
Frontend request ordering does not provide a transaction across webviews.

## Verification

Run pnpm check, pnpm test and pnpm build after changing state boundaries.
Focused model tests cover transitions and response ordering; store integration
tests cover dependency wiring, instance isolation and disposal.

## Service dependencies

- `useLlmActions` wires LLM requests, chat, and text correction.
- `useTranslationActions` wires translation and its error reporting.
- `useDictationActions` wires the microphone session and credential checks.
- `useDesktopInsertion` propagates native paste failures to the invocation layer.
  The invocation reports the toast; native notifications remain available when
  the application is hidden behind the target window.

Capture stores during setup. Bind lazily acquired dependencies to the owner's
Pinia instance rather than whichever Pinia is active when the callback runs.
The invocations, translation, defaultCommands, and toolCatalog stores also own
services without public reactive state. This keeps their dependencies and
lifetimes scoped to the application instead of a module singleton.

## Disposal versus window visibility

Models that own asynchronous work expose an idempotent `dispose()`. Stores connect
it with `onScopeDispose`; the application disposes Pinia on unmount. Disposal
aborts requests, ends claimed external jobs, releases captured selections,
stops retries, and suppresses late UI updates. Native side effects already sent
to the backend cannot be undone by disposing a frontend model.

- `menuModals.closeAll()` removes the menu UI. Pending work may still finish into
  history, as required when closing the main window.
- `menuModals.cancelAndCloseAll()` explicitly cancels pending work before removing
  the UI. Quick-window dismissal and store disposal use this method.
- Hiding a window does not dispose its Pinia instance or background services.

Changing LLM settings, correction rules, instructions, or rule prefix invalidates
both cached corrections and in-flight work. Cancelling speculation alone retains
completed results. Default command synchronization reports failed loads and
writes and retries at most three times with exponential backoff. Disposal stops
the retry queue.
