# Hype feature research

## Snapshot and evidence

This review used Hype `master` at [`f4d5135505349fafe0739ff2ce783a4a3e8b4eae`](https://github.com/omacom/hype/commit/f4d5135505349fafe0739ff2ce783a4a3e8b4eae), release 0.4.1, checked 2026-09-24. It compared the [README](https://github.com/omacom/hype/blob/f4d5135505349fafe0739ff2ce783a4a3e8b4eae/README.md), [Qt editor](https://github.com/omacom/hype/blob/f4d5135505349fafe0739ff2ce783a4a3e8b4eae/src/Main.qml), [deck model](https://github.com/omacom/hype/blob/f4d5135505349fafe0739ff2ce783a4a3e8b4eae/src/deck.cpp), [renderer](https://github.com/omacom/hype/blob/f4d5135505349fafe0739ff2ce783a4a3e8b4eae/src/renderer.cpp), [CLI](https://github.com/omacom/hype/blob/f4d5135505349fafe0739ff2ce783a4a3e8b4eae/src/cli.cpp), [examples](https://github.com/omacom/hype/tree/f4d5135505349fafe0739ff2ce783a4a3e8b4eae/examples), [tests](https://github.com/omacom/hype/tree/f4d5135505349fafe0739ff2ce783a4a3e8b4eae/tests), and [trial report](https://github.com/omacom/hype/blob/f4d5135505349fafe0739ff2ce783a4a3e8b4eae/TRIALS.md). The repository history records the overview implementation in [commit `7bf0306`](https://github.com/omacom/hype/commit/7bf0306d85e3).

## What is implemented upstream

- The Qt editor has Overview, Visual, and Markdown modes. The deck model implements add, duplicate, delete, and move operations; the visual editor also supports multi-slide selection and drag reordering. The source remains the saved document, and deck operations have undo/redo support.
- Media is stored beside the Markdown file. The renderer resolves image and video directives, while the editor handles paste, file selection, and drop. The deck model uses Qt Multimedia for playback.
- The CLI implements `check`, `slides`, `render`, and `export`. `test_cli.py` checks diagnostics, missing media, fences, cramped text, slide outlines, image rendering, and export format selection. The export tests inspect generated PowerPoint relationships and embedded video. These are shipped CLI capabilities, but Elef does not add a local CLI.
- The app implements local version backups and crash recovery. The trial report describes 317 slides used to assess conversion quality and media handling; it explicitly calls the conversion and refinement scripts development fixtures rather than a general importer.
- PDF and PowerPoint export are implemented. Hype's README describes its PowerPoint slides as rendered appearances rather than editable text and shapes, so this is not a fit for Elef's editable presentation export requirement.

## What was not treated as shipped

[Presenter notes PR #6](https://github.com/omacom/hype/pull/6) was open and unmerged at the reviewed snapshot. It was not counted as an upstream feature.

## Elef choices

Elef adopts the slide overview, accessible slide operations, direct image/MP4 insertion, overflow warnings, and browser print-to-PDF. Markdown stays canonical; slide edits use CodeMirror transactions, and media files remain in the existing Active Storage attachments. PPTX and presenter notes are deferred. Omarchy-specific desktop integration and Hype's standalone CLI are outside the Rails app's scope.
