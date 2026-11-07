# Screenshot quick requests

Status: stages 1 and 2 implemented; native acceptance on the platform matrix and
the release size/latency measurements are still to be recorded for both.

Stage 1 implementation notes:

- Backend: `services/screenshot.rs` (orchestration behind the
  `ScreenshotWindows` / `ScreenshotSource` host traits, ownership under the
  `quick/screenshot` image owner, unit-tested without a Tauri runtime),
  `services/runtime/screenshot.rs` (Tauri adapter: threads, windows,
  retake/remove/transfer) and
  `services/platform/screenshot/` (X11 RandR monitor + `GetImage`, Wayland
  Screenshot portal, Windows GDI `BitBlt`). Captures are encoded by
  `ChatImageStore::prepare_capture` without an intermediate PNG. Reduction
  averages the covered source pixels (area filter) to keep thin text readable.
  Raw captures are accepted up to 16384 px per edge and 48 MP and reduced to
  the chat image limits instead of being rejected.
- Monitor choice: X11 and Windows capture the monitor under the pointer. On
  Wayland the portal decides: with portal version 3+ the `Screen` target is
  requested non-interactively; older portals return what the compositor
  captures (GNOME and KDE capture all outputs). Wayland gives clients no global
  pointer position, so TyCo cannot pick the monitor and does not crop portal
  results in stage 1.
- Failure and cancellation restore the previously visible TyCo window; a
  failure emits `app://screenshot-failed`. The quick window shows it as a toast
  when a TyCo window is visible, otherwise as an error status bubble.
- The profile stays locked to Ask AI for the whole screenshot session.
- The screenshot can be retaken or removed until the model has answered over
  it; a first request that failed or was stopped without an answer keeps it
  replaceable.
- Screenshot quick sessions are not saved to editor history; transfer to the
  main chat (`open_screenshot_chat`) persists through normal chat history.

Stage 2 implementation notes:

- The default capture mode is the `quickWindow.screenshotCaptureMode` setting
  (entire screen by default). The preview offers two retake buttons, entire
  screen and area, which pass the mode to `retake_screenshot` explicitly.
- Wayland selects the area natively: the portal `Area` target with portal
  version 3+, otherwise an interactive portal dialog whose UI differs per
  desktop (GNOME offers screen/window/area, KDE opens its own tool).
- X11 and Windows capture the monitor under the pointer first and show
  `ScreenshotSelector.vue` over that frozen image in the quick window, so the
  selector never appears in the pixels. Selection is limited to that monitor.
  A drag draws the rectangle; Enter, double-click or the confirm button accepts
  it, a new drag redraws it, Escape or right click cancels. Crops are mapped from
  the real view size to monitor pixels (`lib/screenshot/area-selection.ts`), so
  the window scale factor does not matter.
- A prompt is identified by its capture generation (`selectionId`), not by the
  activation id: the first capture selects before its activation is published.
  The worker waits with a timeout and stops on shutdown or a newer activation;
  `app://screenshot-select-area-closed` then closes the selector.
- The frozen image is owned by `quick/screenshot-selector` only while shown, so
  cancelling an area retake keeps the previous screenshot. The quick window's
  position, size and always-on-top state are restored after selection.
- Crops are taken from the original pixels before normalization.

## Goal and scope

Use a screenshot as the context of the existing quick AI request overlay, with
either a typed or dictated question. Reuse its answers, follow-up requests and
result actions.

The first release captures one entire screen. Selecting an area on screen is a
separate implementation stage after the full-screen workflow is complete.

Both entry points start with the default **Ask AI** profile selected, regardless
of the profile used in the previous quick request. Use the existing default
profile representation (`profileId: null`), task configuration and instructions;
do not create a new custom profile or a separate screenshot model setting.
Custom-profile screenshot workflows are outside the first release, so the
profile picker stays locked for a screenshot session.

## Existing implementation to reuse

- `src-tauri/src/services/activation/` coordinates activation, target capture and
  stale-result rejection. Screenshot capture must participate in that lifecycle.
- `src-tauri/src/models/activation.rs` and the shared user configuration define
  activation modes and configurable shortcuts.
- `apps/desktop-ui/src/views/QuickAiRequestView.vue` and
  `apps/desktop-ui/src/components/menu/QuickAiRequestMenu.vue` provide the overlay
  and text/voice input modes.
- `apps/desktop-ui/src/lib/quick-ai-request/quick-ai-request-model.ts` owns the
  conversation and result actions. It currently accepts text context and builds
  prompts directly; attaching an image requires explicit image-byte loading.
- The existing chat image importer, native image store and LLM prompt pipeline
  provide normalization, bounded storage, ownership, vision messages and
  provider-error handling. Follow `chat-images.md` for current formats and limits;
  do not introduce a parallel image format or storage system.

Read `architecture.md`, `state-management.md`, `desktop-api.md`,
`cross-platform.md`, `chat-images.md`, `ui-components.md` and `testing.md` before
implementing the corresponding parts.

## Stage 1: full-screen capture and quick request

### 1. Entry points and activation

- Add two configurable global shortcuts: screenshot with text input and
  screenshot with voice input. Register them through existing hotkey providers
  and preserve conflict handling and rollback.
- Both shortcuts create a fresh screenshot request with Ask AI selected. Text
  input is the default; the voice shortcut overrides only the initial input mode.
- Capture the screen before showing the quick overlay. If a TyCo window is
  already visible, coordinate hiding it and waiting for the compositor to update
  before capture. Preserve the foreign target needed for existing insertion
  actions.
- For multiple monitors, capture the entire monitor containing the pointer at
  invocation time, rather than stitching all monitors into one image. Resolve
  the monitor before window changes. Exception: on Wayland the portal decides
  what is captured (a system chooser, or all outputs on GNOME/KDE), because
  clients cannot learn the pointer's monitor; use that result as is and
  document the platform difference.
- Associate capture with the activation generation. Cancellation, a newer
  activation or shutdown must discard a late result and release its resources.
  Do not start microphone recording while a capture dialog is still active.

### 2. Native capture service

- Put OS-specific capture behind `services/platform/`, using
  `platform::session::current()` to select the Linux session path. Keep capture
  orchestration testable with an injected backend; IPC commands remain adapters.
- Linux Wayland: use the Screenshot portal through the existing `ashpd`
  dependency with its `screenshot` feature enabled. Check supported interface
  capabilities; do not assume that every portal supports an explicit screen
  target or silent capture. Handle system consent, cancellation and unsupported
  backends explicitly. Stage 1 must not silently enter area-selection mode.
  A failure must be visible even when no TyCo window was open before capture.
- Linux X11: reuse the portal where suitable or implement full-monitor capture
  through the existing `x11rb` dependency. Handle actual pixel layout and monitor
  geometry rather than assuming a fixed RGB format.
- Windows: use native capture through `windows-sys`, adding API features only as
  needed. Account for monitor coordinates, DPI scaling and capture failures.
- Feed pixels into the existing bounded image-normalization pipeline. Audit
  decoded-pixel and byte limits for large/HiDPI screens before allocating; avoid
  rejecting valid captures only because an intermediate full-size PNG exceeds a
  file-import limit. Reduce oversized captures (for example several monitors
  from a portal) to the image limits rather than rejecting them. Preserve
  readable text using the existing quality policy and an area-averaging filter.
- Portal output may be a temporary file. Read only the result authorized by the
  capture operation; validate it and clean up application-owned temporary data
  according to the portal contract. Do not claim that capture never touches disk.
- Add generated IPC types, command registration and explicit capabilities where
  required. Pass image references in activation state, not base64 image payloads
  in desktop snapshots or events.

### 3. Overlay and question input

- Show one screenshot preview in the existing quick request overlay, with an
  enlarged view, removal and retake actions. No region selector or annotation
  editor in this stage.
- In text mode, focus the question field after capture. In voice mode, start the
  existing recognition flow once capture succeeds and the overlay is ready;
  submit the recognized question through the same request path as typed text.
- Allow switching between text and voice without losing the screenshot or draft.
  Retaking replaces the screenshot only after successful capture; cancellation
  retains the previous screenshot and question. Retake and removal stay
  available until the model has answered over the screenshot.
- Require a nonempty typed or recognized question for the first release. Taking
  a screenshot alone must not trigger an LLM request.
- Reuse existing submit, cancel, streaming, reply blocks and result actions.
  Preserve drafts on model/network errors. Existing text-only quick requests
  keep their current behavior.
- Add real translations for all supported locales for shortcuts, preview actions
  and capture/vision errors.

### 4. Multimodal request and session ownership

- Extend the quick request model with image context and an injected image loader.
  Attach the screenshot to the first user turn, load its bytes into
  `buildLlmPrompt`, and retain that context for follow-up questions and retries.
  Do not replace the image with OCR or send the same screenshot as a new
  attachment on every turn.
- Resolve the model through the existing Ask AI / quick-request configuration.
  Check vision capability before sending; show an actionable localized error
  when the configured model cannot accept images. Never silently drop the image
  or switch providers. Reuse provider rejection handling as well as configured
  capability checks.
- Keep image ownership while a draft, active request, retained quick session or
  handoff needs it. Hiding a retained session must not invalidate its image;
  clearing/replacing that session must release unneeded ownership.
- Transfer the screenshot and conversation when opening the main chat. Acquire
  destination ownership before releasing the quick session's ownership, and
  preserve the source session if transfer fails.
- Persist screenshot pixels only under the existing applicable history policy.
  Audit editor-history session records: they currently describe text operations.
  For stage 1, keep screenshot quick sessions ephemeral in editor history rather
  than saving incomplete, unrestorable entries. Explicit transfer to main chat
  uses normal chat history settings and image persistence.
- Keep HTTP traffic in the existing Rust network gateway. Local capture and
  preview work offline; answering depends on the configured vision provider,
  which may itself be local. Do not add OCR models or a new network service.

### 5. Verification and release evidence

- Model tests: default Ask AI selection, text/voice parity, first-turn image
  context, follow-ups, retry, missing bytes, unsupported vision, provider errors,
  cancellation, replacement and ownership transfer.
- Activation/service tests: capture before showing the overlay, delayed stale
  results, cancellation, retake failure, monitor choice and bounded decoding.
- Component tests: preview/removal, input switching, draft retention and voice
  startup only after successful capture, using the fake desktop infrastructure.
- Native checks on Windows, Linux X11, KDE Wayland and GNOME Wayland; include
  a supported wlroots session where available. Exercise portal consent/refusal,
  multiple monitors, mixed DPI, an already visible TyCo window and repeated
  hotkeys. Record unsupported behavior rather than claiming uniform portal UX.
- Run `pnpm generate:desktop` after IPC changes, then `pnpm check`, `pnpm test`,
  `pnpm check:rust` and `pnpm test:rust`. Run the relevant desktop/browser smoke
  checks for the changed paths.
- Compare release artifact sizes before and after on the same target/toolchain;
  record installer and executable size deltas separately. Measure capture-to-
  preview latency and peak memory on normal and HiDPI monitors.

Stage 1 is complete when both shortcuts produce a full-screen preview with
Ask AI selected, text and dictated questions reach the configured vision model
with that image, follow-ups retain context, and cancellation/cleanup work on the
supported platform matrix.

## Stage 2: selecting an area on screen

Start this stage only after full-screen capture is complete. Reuse the same
image context, input modes, profile, ownership and request pipeline.

1. Add an explicit capture-mode choice between entire screen and selected area;
   retain full-screen capture as the initial default.
2. Resolve the selection strategy per platform. Prefer system region selection
   when supported. Where a TyCo selector is necessary and the OS permits it,
   capture first and draw the selection over a frozen image; never include the
   selector itself in the captured pixels. On Wayland, system capture consent
   remains governed by the compositor/portal.
3. Implement drag selection with a dimmed exterior, visible bounds and Escape
   cancellation. Reject empty selections; do not send a request on selection
   completion alone. Return the crop to the same preview and question flow.
4. Map logical coordinates to physical pixels, including mixed DPI, negative
   monitor origins and monitor boundaries. Specify whether cross-monitor
   selection is supported before implementing it; a single-monitor first
   selector is acceptable if the UI makes that boundary clear.
5. Crop locally before normalization/upload and release the full-screen source
   when it is no longer needed. Retake/cancel must preserve the prior draft.
6. Add coordinate/cropping unit tests and native acceptance checks for selection,
   cancellation, multiple monitors, DPI and portal differences on the same OS
   matrix as stage 1.

Stage 2 is complete when the selected pixels reach the LLM through both entry
points and full-screen capture remains available.

## Dependencies and build impact

Start with dependencies already in the application: `ashpd`, `x11rb`,
`windows-sys` and the image codecs. Enable only required features. A dedicated
screen-recording library, OCR engine or bundled vision model is not required.
Do not promise a numeric size increase until the release comparison is recorded.

Portal references:

- [Screenshot portal contract](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Screenshot.html)
- [ashpd 0.13.13 screenshot module](https://docs.rs/ashpd/0.13.13/ashpd/desktop/screenshot/index.html)
