---
name: Elef Slide Editing
description: Contextual controls for editing Markdown presentations as a stack of slides.
status: final
updated: 2026-08-18
colors:
  app-background: '#f4f3ed'
  panel-background: '#fbfaf5'
  text: '#26302b'
  text-muted: '#66706a'
  border: '#c8ccc5'
  accent: '#2f7655'
  accent-hover: '#255f45'
  danger: '#a33b35'
  danger-background: '#f8e7e3'
typography:
  body:
    fontFamily: 'DM Sans, ui-sans-serif, system-ui, sans-serif'
    fontSize: 16px
    lineHeight: '1.5'
  source:
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
    fontSize: 15px
    lineHeight: '1.65'
rounded:
  sm: 4px
  md: 6px
  lg: 8px
spacing:
  control-gap: 8px
  slide-gap: 32px
components:
  add-slide:
    background: '{colors.accent}'
    foreground: '#f7fff9'
    radius: '{rounded.md}'
  delete-slide:
    foreground: '{colors.danger}'
    radius: '{rounded.md}'
  active-slide:
    outline: '{colors.accent}'
    radius: '{rounded.lg}'
---

## Brand & Style

The slide editor should feel like a calm writing tool: the presentation remains the focus, and controls appear where the next action is expected. Existing Elef editor tokens are retained; this UX adds contextual affordances without introducing a second visual language.

## Colors

- `{colors.accent}` identifies actions that change the slide structure and the currently active slide.
- `{colors.danger}` is reserved for Delete and destructive recovery messaging.
- `{colors.text-muted}` supports helper copy and secondary controls, never essential instructions.

## Typography

Use the existing body and source roles. Button labels are short, explicit verbs: “Add slide”, “Delete slide”, and “Undo”.

## Layout & Spacing

The slide stack remains vertical. Place Add Slide between adjacent slides so its insertion point is unambiguous. Keep Delete on the active slide rather than in a distant global toolbar.

## Elevation & Depth

Use the existing slide shadow and active outline. Do not add modal depth for routine add/delete actions.

## Shapes

Use existing Elef radii. Add and Delete controls are compact but maintain the existing keyboard-focus treatment and minimum target size.

## Components

- **Add slide** — contextual control between slides; uses the primary accent and inserts after the preceding slide.
- **Delete slide** — contextual destructive control on the active slide; does not require confirmation.
- **Undo notice** — temporary, clearly labeled recovery action after deletion.
- **Active slide** — accent outline indicates where keyboard and contextual actions apply.

## Do's and Don'ts

| Do | Don't |
|---|---|
| Show the insertion point beside the Add control | Hide Add behind a menu |
| Use explicit text labels with icons only as reinforcement | Rely on an unlabeled icon |
| Preserve the visible `---` source separator | Replace portable Markdown with hidden proprietary state |
| Keep Delete recoverable through Undo | Interrupt routine editing with confirmation dialogs |
