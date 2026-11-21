# Plan: dialog history and call recording

Status: planned. When done, move the outcome into `architecture.md`,
`config-storage.md`, `docs/dialog.md` and `docs/data-folder.md`, then delete
this file.

## Decisions

- **A session per start.** Every **Start** / **Start recording** clears the
  feed and begins a new session. The **Clear the transcript** action is
  removed. One session is one history entry: the transcript text and, when
  recorded, one audio file. With history disabled, Start simply discards the
  previous conversation.
- **No dialog-specific history switch.** Dialog entries follow the global
  history setting and its retention (`history-retention`).
- **History shows plain text.** The entry stores the finished transcript in
  the export format (`dialog-export.ts`); no turn-by-turn viewer.
- **Checkpoints.** Final turns (and translations that arrive later) are
  written to the entry periodically (every 15 s while dirty) and on Stop,
  window hide and app quit. Interim words are not written.
- **Recording format: Ogg/Opus, encoded while capturing.** No raw buffer, no
  post-processing, no splitting. Ogg pages are self-contained, so a crash
  leaves a file playable up to the last flushed page; no finalization or
  repair is needed.
  - `microphoneAndSystem`: stereo, channel 0 the microphone, channel 1 the
    computer, 32 kbit/s (`OPUS_APPLICATION_VOIP`).
  - `system`: mono, 24 kbit/s, `OPUS_APPLICATION_VOIP`.
  - Input: the 16 kHz capture stream as is (Opus wideband); 20 ms frames;
    flush an Ogg page at least every second.
  - The microphone is recorded **before** the echo gate: the file keeps
    what was actually heard.
  - Crates: `opus` (libopus, statically built) and `ogg`; verify Linux and
    Windows CI builds before anything else.
- **Recordings folder** is a device setting (`dialog.recordingsFolder`,
  `x-scope: device`), default `XDG_MUSIC_DIR/TyCo` on Linux and
  `%USERPROFILE%\Music\TyCo` on Windows (resolved in Rust, falling back to
  `$HOME/Music/TyCo`). Created on first recording. Changing it moves nothing.
  File name: `TyCo dialog YYYY-MM-DD HH-MM-SS.opus`, collision suffix ` (2)`.
- **History links by absolute path.** A missing file is shown as "file not
  found"; nothing tries to keep links valid. Deleting a history entry does not
  delete the audio file.
- **No playback for now.** The entry shows the file name with **Show in
  folder** (and "file not found" when it is gone). In-app playback via the
  asset protocol (as in `../fastcat`: runtime
  `asset_protocol_scope().allow_directory`, `media-src asset:` already in the
  CSP) is a later step.
- **Consent notice.** The first **Start recording** shows a notice: when
  recording a conversation with another person, tell them first. **Got it**
  starts the recording and sets `dialog.isRecordingNoticeAcknowledged` in the
  user settings (not shown in the settings UI); **Cancel** starts nothing.
- **Start button** becomes a split button: the main part is always **Start**
  (no recording); the chevron menu has **Start recording**. The last choice
  is not remembered. While recording, the toolbar shows a recording indicator
  with elapsed time (the subtitles strip too).
- **External control** (CLI / D-Bus) cannot start a recording; its start keeps
  meaning plain Start.

## Steps

1. **Encoder spike (Rust).** Add `opus` + `ogg`; a
   `services/voice/recording.rs` writer: `OggOpusWriter::create(path,
   channels)`, `push(&[i16])`, `finish()`; OpusHead/OpusTags, granule
   positions, page flushing. Unit tests: decode-free checks of headers, page
   sequence, granule monotonicity; a truncated file still parses up to its
   last page. Confirm the Windows CI build.
2. **Tap the capture.** The dialog capture gets an optional recording target
   (`DialogRecording { path }` on the start command). The capture loop hands
   the raw interleaved PCM (before `echo_gate`) to the writer on a separate
   thread over a bounded channel; a write error (disk full, folder gone)
   stops the recording only, emits an event, and the dialog continues. Stop
   and quit call `finish()`.
3. **Settings.** `dialog.recordingsFolder` (device) and
   `dialog.isRecordingNoticeAcknowledged` in `dialog-config.ts`, the schema,
   defaults and Rust settings; a default-folder resolver in
   `services/platform/`. **Settings → Dialog**: folder picker with
   **Reset to default** and **Open folder**.
4. **History storage.** A dialog entry kind in the editor history journal
   (as `Draft`: upserted by id) carrying `text`, `startedAt`, `source`,
   optional `recordingPath`. Commands to upsert and finish the entry; run
   `pnpm generate:desktop`.
5. **Frontend model** `lib/dialog/dialog-history.ts`: owns the session id,
   tracks dirtiness, checkpoints on the interval and lifecycle events through
   injected dependencies; tests with fake timers. `dialog-session.ts`: start
   resets the transcript and opens a new history session; remove the clear
   action.
6. **UI.** Split Start button, consent notice, recording indicator in
   `DialogToolbar.vue` and `SubtitlesOverlay.vue`; history item meta for
   dialog entries (icon, "Dialog", recording file name / "file not found",
   **Show in folder**). i18n keys in every locale.
7. **Docs and checks.** Update `docs/dialog.md` (no longer "nothing is
   saved"; recording, consent, folder), `docs/data-folder.md` (recordings live
   outside the data folder), `architecture.md`, `config-storage.md`. Run
   `pnpm check`, `pnpm test`, `pnpm check:rust`, `pnpm test:rust`.

## Open points to check while implementing

- Whether the capture loop exposes the raw stereo before the echo gate
  without copying twice.
- The exact Windows known-folder API for Music (`FOLDERID_Music`).
- Whether a stopped-and-restarted session should keep its history entry if
  it has no turns (proposed: do not create entries for empty sessions).
