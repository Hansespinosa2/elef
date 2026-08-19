# Editor UX recovery test plan

This is the test-to-spec map. Every behavior matrix item gets a test before
production code for that behavior changes. Tests are written in one pass, then
implemented slice by slice.

## Test layers

| Layer | Purpose | Primary files |
| --- | --- | --- |
| Model | Pure source ranges, delimiter invariants, Markdown transforms, split plans | `tests/unit/presentation.test.ts` |
| Integration | CodeMirror transactions, decorations, reveal, widgets, focus, controls | `tests/integration/presentation-preview.test.tsx` |
| Persistence | Debounce, retry, recovery, stale-write ordering, flush | `tests/unit/world-workspace.test.ts`, `tests/unit/presentation-editor.test.ts` |
| Browser smoke | Real WebView geometry, caret placement, scrolling, repeated transitions | `tests/e2e/arrow-navigation.spec.ts`, new focused specs under `tests/e2e/` |

## Slice 1: source authority and Obsidian reveal

**Spec IDs:** `AUTH-*`, `REVEAL-*`, `TEX-*`, `MD-*`.

**Tests:** canonical source ownership; read-only widget transactions; line-local
reveal; bounded structured units; click-to-caret mapping and fallback;
selection/paste/cut/delete; native undo/redo; Markdown and TeX preservation;
malformed-render fallback; repeated click/edit/rerender resilience.

**Order:** model range tests → integration transaction/reveal tests → browser
click/caret and repeated-transition smoke tests.

## Slice 2: slide surfaces and navigation

**Spec IDs:** `SURFACE-*`, `NAV-*`, `BOUNDARY-*`.

**Tests:** coherent themed surfaces; no nested scrollbars; true visual-line
arrow handoff; empty-slide focus; add/delete/only-slide invariant; structural
delimiter typing, deletion, fenced-code/front-matter exclusion; controls
outside source.

**Order:** delimiter and slide model tests → integration command/focus tests →
browser boundary and native-caret smoke tests.

## Slice 3: overflow inspection and explicit splitting

**Spec IDs:** `OVERFLOW-*`, `SPLIT-*`.

**Tests:** inline scrollbar and warning; continued editing while overflowing;
stable source/selection on cancel; preview canonical source; safe split points;
content preservation; focus of new slide; refusal when unsafe; exact undo.

**Order:** pure split-plan tests → integration preview/confirm/undo tests →
browser scrolling smoke test.

## Slice 4: persistence and presentation

**Spec IDs:** `SAVE-*`, `RECOVERY-*`, `PRESENT-*`, `RESILIENCE-*`.

**Tests:** debounced latest-source saves; retry ordering; silent snapshots;
flush/queue on switch and close; browser/Tauri behavior parity; fixed 16:9
playback; navigation/fullscreen; selection restoration; rendering failure
fallback; accessibility and reduced motion.

**Order:** persistence/model tests → integration mode-transition tests →
targeted browser playback and failure smoke tests.

## TDD gate

1. Add all matrix tests with explicit IDs and failing assertions.
2. Run the smallest affected test file and record the first expected failures.
3. Implement one slice without weakening existing assertions.
4. Require that slice's model and integration tests to pass before browser smoke.
5. Run the full fast suite only after all four slices are green.
