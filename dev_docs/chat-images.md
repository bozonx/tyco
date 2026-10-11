# Chat files and vision

The composer has one file picker, clipboard file paste, and native Tauri file
drops. All paths use the same bounded, sequential importer. An error is reported
for each file; later files still import. Replacing the draft discards late
results. Native reads keep the composer busy before disk IO begins.

## Formats and local processing

- PNG, JPEG, and non-animated WebP are decoded, drawn into a canvas, and
  normalized to PNG. Rust validates and re-encodes pixels, stripping metadata.
- Text files (including Markdown, CSV, JSON, configuration, and supported source
  code extensions) are read as UTF-8, or BOM-marked UTF-16. Invalid encodings and
  NUL-containing binary content are rejected. File names and media types are
  preserved in history, previews, prompts, and text export.
- DOCX extraction reads only `word/document.xml` with bounded streaming ZIP
  inflation. Paragraphs, table cells, tabs, and breaks are converted to plain
  text. Embedded images, document layout, headers, and external relationships
  are not included. DTDs and entities are rejected.
- PDF text is extracted locally using PDF.js. Pages without a readable text
  layer, including image scans with only a small footer text layer, are rendered to images and use the same vision import path. Mixed PDFs
  preserve both text and rendered pages. Password-protected and oversized
  documents receive explicit errors. Rendered pages have named page numbers.
  There is no separate OCR service; the vision model interprets scan pages.

PDF.js runs in a bundled legacy worker. CMaps, standard fonts, and WASM resources
are served from local `pdf-assets/` in both dev and production. No CDN or CSP
relaxation is required. The parser does not execute PDF document actions.

## Quality and limits

Settings → language models → chat attachments controls new image imports:

- Economy: longest edge up to 1024 pixels.
- Balanced (default): longest edge up to 1568 pixels.
- No resizing: retain decoded pixel dimensions within safety limits.

Every mode strips metadata and stores normalized PNG, not the original file.
Changing quality does not reconstruct previously reduced images. PDF scans are
rendered at up to twice their PDF point dimensions, with a 3072-pixel longest
edge, before the chosen normalization policy applies.

Source files are limited to 10 MiB. Images are limited to 24 million pixels,
16384 pixels per edge, and 20 MiB after normalization. Each new message accepts
up to four images and sixteen file attachments (rendered pages consume image
slots). Extracted text is limited to 500000 characters, DOCX document XML to
4 MiB after decompression, and PDF documents to 100 pages. Scan PDFs exceeding
the available image slots must be split. Unsupported formats are never sent
as arbitrary binary data.

Text-extracted documents work with ordinary text models. Only image attachments
and rendered PDF scan pages require a vision model. The model selector marks
models configured for vision. The flag describes expected capability; the
provider can still reject the request. Image request rejection gets a localized
explanation and bounded server details, while authentication, context, and
network errors retain their respective explanations.

## Context and history

Four images is a per-new-message import limit, not a limit on the full request.
Older turns are retained while the conservative context budget allows them.
Image allowances grow for large originals. This is an estimate, not a
provider-specific tokenizer. Excluded old turns are reported in the composer.

Vision is checked against the actual trimmed request. An old image outside the
request does not prevent using a text model. If retained images require vision,
the user can explicitly continue without previous images. Only the prepared
request is changed: omission markers are added, stored history stays intact,
and previous images can be included again. Newly attached images still require
vision even when historical images are excluded.

Image-only and file-only messages, retry, regeneration, branching, and Markdown
export are supported. Text export includes file names and text; image pixels
are explicitly marked as omitted.

## Image ownership

Rust bounds retained compressed image bytes to 128 MiB per session. Active
window images, imports, and unfinished history writes own their bytes. Import
and history-loading leases protect against older ownership updates racing with
new imports. Window ownership is reconciled after imports and history loading
finish. Removing a draft image or switching chats releases unneeded bytes.
Destroying a window releases its ownership and import leases. Deleted chat images
are temporarily held for Undo; the sidebar releases them after restoration,
expiry, replacement, or unmount. A backend deadline also bounds abandoned undo
owners.

Unowned read cache entries are evicted under pressure. Owned data is never
silently evicted. An active chat that itself exceeds the session quota receives
an error; starting another chat releases its ownership. History-loaded images
remain available to an active chat if saved history is deleted. Unsaved drafts
never touch disk. History persistence stores validated hash-addressed images
atomically; orphan collection scans surviving chat references.

## Verification

Unit tests cover file classification, encoding, per-file failures, decompression
limits, mixed PDFs, scan rendering, cancellation, queues, ownership handoff,
context trimming, explicit historical image omission, attachment-only messages,
file metadata roundtrips, and provider image rejection. Rust tests cover owners
across windows, cache eviction, quotas, bounded native reads, normalization,
history persistence, and orphan collection.

Browser smoke checks exercise actual PDF text extraction, scan rendering, and
image normalization under a CSP equivalent to the production directives used
by these paths. Native picker, clipboard, drop events, and real provider calls
still need release verification on each supported OS.
