---
title: 'Migrate styling to Tailwind'
type: 'refactor'
created: '2026-08-19'
status: 'done'
review_loop_iteration: 0
baseline_commit: '0f781178237cc3592c76236236f4112632fdae95'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Elef's styling is spread across three large hand-authored stylesheets totaling more than 500 lines. The current CSS is difficult for agents to load and reason about, and repeated layout, spacing, color, and control rules make future UI changes expensive.

**Approach:** Introduce Tailwind as the styling source for application chrome and reusable UI surfaces, centralize the existing theme tokens in Tailwind's configuration, and retain only narrowly scoped CSS for CodeMirror, Markdown-rendered elements, pseudo-elements, and third-party markup that cannot be expressed safely as component utilities. This is a mechanical migration: the existing visual design and behavior remain unchanged.

## Boundaries & Constraints

**Always:** Preserve the current light/dark themes, CSS custom-property values, responsive breakpoints, accessibility states, typography, slide sizing, CodeMirror behavior, Markdown rendering, and Tauri/browser workflows. Use the existing package manager and Vite integration. Keep dynamic state classes and selectors stable where tests or CodeMirror decorations depend on them. Prefer shared Tailwind theme tokens and readable utility composition over duplicated arbitrary values. Keep the final custom stylesheet limited to rules that require descendant selectors, pseudo-elements, generated markup, or third-party DOM.

**Ask First:** Any visual redesign, new component library, Tailwind plugin beyond the official Vite integration, removal or renaming of semantic classes used by tests or CodeMirror decorations, or change to the existing theme palette and typography.

**Never:** Do not rewrite React behavior, migrate CodeMirror to another editor, replace Markdown rendering, add a CSS-in-JS dependency, or convert every selector into an unreadable string of arbitrary utilities merely to eliminate a stylesheet. Do not change layout, spacing, colors, responsive behavior, or interaction semantics.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Light theme | `data-editor-theme="light"` or `.theme-light` | Application chrome, editor, and slides match the current light rendering | Preserve fallback token values |
| Dark theme | `data-editor-theme="dark"` or `.theme-dark` | Application chrome, editor, and slides match the current dark rendering | No flash or missing token styles |
| Responsive layout | Viewport at existing mobile breakpoints | Sidebar, editor toolbar, and slide controls retain current wrapping and sizing | Build must not emit invalid CSS |
| Dynamic states | Active, hidden, source-mode, overflow, disabled, and focus-visible classes | Existing state-specific styling remains applied | Preserve selectors required by runtime-generated DOM |

</frozen-after-approval>

## Code Map

- `package.json` -- add Tailwind and the official Vite integration without changing runtime dependencies.
- `package-lock.json` -- lock the new development dependencies using npm.
- `vite.config.ts` -- register the Tailwind Vite plugin alongside the existing React plugin.
- `src/app.css` -- become the Tailwind entrypoint, theme-token definition, global resets, and retained cross-application custom CSS.
- `src/components/PresentationPreview.css` -- migrate reusable editor/chrome utilities and preserve only complex slide, CodeMirror, pseudo-element, and generated-markup rules.
- `src/components/MarkdownEditor.css` -- fold the simple Markdown editor styles into Tailwind classes or the shared entrypoint, then remove the redundant stylesheet import/file if no longer needed.
- `src/App.tsx`, `src/components/PresentationEditor.tsx`, `src/components/MarkdownEditor.tsx`, `src/components/RecoverableErrorBoundary.tsx` -- apply utilities where they improve locality while preserving semantic classes used by behavior and tests.
- `tests/unit`, `tests/integration`, `tests/e2e` -- existing behavioral and browser coverage is the regression oracle; no test contract should change.

## Tasks & Acceptance

**Execution:**
- [x] `package.json`, `package-lock.json`, `vite.config.ts` -- add and configure Tailwind through the official Vite plugin -- generate styles through the existing build pipeline without introducing PostCSS configuration unless required.
- [x] `src/app.css` -- define the existing palette, typography, spacing conventions, responsive values, and global utilities in Tailwind -- centralize shared design tokens without changing their resolved values.
- [x] `src/App.tsx`, `src/components/MarkdownEditor.tsx`, `src/components/RecoverableErrorBoundary.tsx` -- replace straightforward layout/control declarations with Tailwind utilities -- reduce duplicated CSS while preserving semantic state classes and accessibility behavior.
- [x] `src/components/PresentationEditor.tsx`, `src/components/PresentationPreview.css` -- migrate safe presentation/editor rules and retain a small complex-rules layer -- preserve CodeMirror decorations, slide geometry, generated widget markup, pseudo-elements, and Markdown descendant styling.
- [x] `src/components/MarkdownEditor.css` -- remove or empty the redundant stylesheet after its rules are migrated -- avoid duplicate sources of truth.
- [x] `tests/unit`, `tests/integration`, `tests/e2e` -- run existing tests and targeted presentation/sidebar checks -- prove behavior and generated DOM remain stable.

**Acceptance Criteria:**
- Given the app is built, when Vite processes the application, then Tailwind-generated CSS is emitted successfully and no removed stylesheet import remains.
- Given light or dark theme mode, when the same presentation and sidebar states are rendered, then their computed visual tokens and responsive structure match the pre-migration behavior.
- Given edit mode, source mode, presentation mode, overflow warnings, slide actions, and CodeMirror selection states, when the user interacts with them, then all existing affordances and layout boundaries remain intact.
- Given the existing unit, integration, and targeted E2E suites run, when assertions inspect source, accessibility labels, state classes, and slide rendering, then they pass without test-only styling changes.

## Verification

**Commands:**
- `npm install` -- expected: Tailwind dependencies are installed and the lockfile updates cleanly.
- `npm test -- --run` -- expected: existing unit and integration tests pass.
- `npm run build` -- expected: TypeScript and Vite/Tailwind compilation succeed.
- `git diff --check` -- expected: no whitespace errors.

**Manual checks (if no CLI):**
- Run the app in light and dark modes at desktop and mobile widths; compare sidebar, editor, slide playback, source mode, overflow warning, and recovery screen against the pre-migration behavior.

## Suggested Review Order

**Tailwind foundation**

- Review the Tailwind entrypoint, theme token bridge, and cascade layering.
  [`app.css:1`](../../src/app.css#L1)

- Review Vite plugin registration and dependency integration.
  [`vite.config.ts:1`](../../vite.config.ts#L1)

**Application surfaces**

- Review utility migration across browser and Tauri application chrome.
  [`App.tsx:238`](../../src/App.tsx#L238)

- Review editor controls and preserved presentation-themed states.
  [`PresentationEditor.tsx:960`](../../src/components/PresentationEditor.tsx#L960)

- Review the retained CSS boundary for CodeMirror and generated slide markup.
  [`PresentationPreview.css:1`](../../src/components/PresentationPreview.css#L1)

**Supporting changes**

- Review the Markdown textarea utility migration and removed stylesheet dependency.
  [`MarkdownEditor.tsx:15`](../../src/components/MarkdownEditor.tsx#L15)

- Review dependency versions and lockfile updates.
  [`package.json:31`](../../package.json#L31)
