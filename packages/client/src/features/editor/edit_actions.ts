// Shared Edit-actions menu and keyboard reference: one explicitly-opened
// affordance for trigger-driven authoring plus the shortcut map, mounted by
// both visual editors (documents and presentations, web and desktop).
// Restrained by design: a single toolbar button, an overlay menu that never
// takes layout space, and a native dialog for the reference. Controls never
// change content geometry: the menu and dialog are out-of-flow overlays and
// the button joins the existing toolbar row.
//
// Each trigger action is a plain source transaction at the caret (engine
// replaceRange, pipelined through the projection host in visual mode), so
// the action behaves exactly like typing the trigger: the matching assist
// palette opens from the same refresh paths. After inserting, the menu
// dispatches `elef:assist-trigger-inserted` so runtime palettes re-refresh
// against the restored caret (in source mode the engine's own textarea
// input event already refreshed them; the extra refresh is idempotent).
import { SHORTCUT_ACTIONS, chordDisplay } from "../shortcuts/shortcuts.js";

export const ASSIST_TRIGGER_INSERTED_EVENT = "elef:assist-trigger-inserted";

export interface EditActionsEditor {
  readonly value: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly editingMode: string;
  replaceRange(insert: string, from: number, to: number): void;
  focus(): void;
}

export interface EditActionsHost {
  applyVisualAssistInsert?: (edit: { from: number; to: number; insert: string; caret: number }) => boolean;
}

export interface EditTriggerAction {
  readonly id: string;
  readonly label: string;
  readonly trigger: string;
  // Palette elements render only where their controller is registered, so a
  // row appears only when its palette can actually open (Stable-profile
  // shells simply offer fewer rows).
  readonly paletteTarget: string;
}

export const EDIT_TRIGGER_ACTIONS: readonly EditTriggerAction[] = Object.freeze([
  Object.freeze({
    id: "snippet",
    label: "Insert snippet or directive",
    trigger: "/",
    paletteTarget: '[data-snippet-palette-target="palette"]',
  }),
  Object.freeze({
    id: "link",
    label: "Insert document link",
    trigger: "[[",
    paletteTarget: '[data-document-link-palette-target="palette"]',
  }),
  Object.freeze({
    id: "math",
    label: "Insert math shortcut",
    trigger: "@",
    paletteTarget: '[data-math-shortcut-palette-target="palette"]',
  }),
  Object.freeze({
    id: "diagram",
    label: "Insert diagram",
    trigger: "/diagram",
    paletteTarget: '[data-mermaid-assist-target="palette"]',
  }),
]);

// Static editor vocabulary for the reference: trigger characters plus the
// accept/cancel keys every assist palette honors. Mirrors the editor
// field-hint text; the global section below renders from the registry.
export interface KeyboardReferenceTrigger {
  readonly keys: string;
  readonly description: string;
}

export const KEYBOARD_REFERENCE_TRIGGERS: readonly KeyboardReferenceTrigger[] = Object.freeze([
  Object.freeze({ keys: "/", description: "Snippet and structure suggestions" }),
  Object.freeze({ keys: ":", description: "Elef directive suggestions" }),
  Object.freeze({ keys: "[[", description: "Document link suggestions" }),
  Object.freeze({ keys: "@", description: "Math shortcut suggestions" }),
  Object.freeze({ keys: "/diagram", description: "Mermaid diagram assist" }),
  Object.freeze({ keys: "$…$", description: "Math shorthand commits with Space, Enter, or Tab" }),
  Object.freeze({ keys: "Enter / Tab", description: "Accept the selected suggestion" }),
  Object.freeze({ keys: "Tab", description: "Walk multi-slot expression stops" }),
  Object.freeze({ keys: "Esc", description: "Close the open palette" }),
]);

export interface MountEditActionsOptions {
  readonly field: HTMLElement;
  readonly getEditor: () => EditActionsEditor | null;
  readonly host?: EditActionsHost | null;
  readonly platform?: "mac" | "other";
}

export interface EditActionsMount {
  readonly root: HTMLElement;
  dispose(): void;
}

function detectPlatform(): "mac" | "other" {
  const platform = typeof navigator === "undefined" ? "" : navigator.platform ?? "";
  return /mac/i.test(platform) ? "mac" : "other";
}

function actionChip(action: { webChord: string | null; desktopChord: string | null; palette: boolean }, platform: "mac" | "other"): string {
  const chord = action.webChord ?? action.desktopChord;
  if (chord) return `<kbd>${chordDisplay(chord, platform)}</kbd>`;
  return action.palette ? `<span class="keyboard-reference-palette-tag">Palette</span>` : "";
}

export function renderKeyboardReference(platform: "mac" | "other"): string {
  const globalRows = SHORTCUT_ACTIONS.map((action) =>
    `<li><span class="keyboard-reference-keys">${actionChip(action, platform)}</span><span class="keyboard-reference-label">${action.label}</span><span class="keyboard-reference-description">${action.description}</span></li>`,
  ).join("");
  const triggerRows = KEYBOARD_REFERENCE_TRIGGERS.map((trigger) =>
    `<li><span class="keyboard-reference-keys"><kbd>${trigger.keys}</kbd></span><span class="keyboard-reference-description">${trigger.description}</span></li>`,
  ).join("");
  return `<h2 id="keyboard-reference-title">Keyboard shortcuts</h2>` +
    `<p class="keyboard-reference-lede">Visual and source modes share every shortcut. Global chords need ⌘/Ctrl, so Vim normal mode never collides with them.</p>` +
    `<h3>Global</h3><ul class="keyboard-reference-list">${globalRows}</ul>` +
    `<h3>Editor triggers</h3><ul class="keyboard-reference-list">${triggerRows}</ul>` +
    `<p class="keyboard-reference-lede">Vim motions, operators, and text objects work in both modes; toggle Vim mode from the command palette.</p>`;
}

// A real pointer click always follows its mousedown with detail >= 1 (the
// click count); keyboard and assistive-tech activation arrives as a lone
// click with detail 0. The menu runs pointer rows on mousedown (prevented,
// so the projection caret never moves) and keyboard rows on click.
export function clickFollowsPointer(event: { detail?: number | undefined }): boolean {
  return (event.detail ?? 0) !== 0;
}

export function mountEditActions({ field, getEditor, host = null, platform = detectPlatform() }: MountEditActionsOptions): EditActionsMount | null {
  const toolbar = field.querySelector(".editor-toolbar");
  if (!toolbar) return null;

  const owner = field.ownerDocument ?? document;
  const root = owner.createElement("div");
  root.className = "edit-actions";
  const available = EDIT_TRIGGER_ACTIONS.filter((action) => field.querySelector(action.paletteTarget));
  const mediaButton = field.querySelector<HTMLElement>('[data-editor-view-target="mediaButton"]');
  const mediaOffered = mediaButton && !(mediaButton as HTMLButtonElement).disabled && !((mediaButton as HTMLElement).hidden);
  const rows = available.map((action) =>
    `<button type="button" role="menuitem" data-edit-actions-row="trigger:${action.id}"><span>${action.label}</span><kbd>${action.trigger}</kbd></button>`,
  );
  if (mediaOffered) rows.push(`<button type="button" role="menuitem" data-edit-actions-row="media"><span>Add image…</span></button>`);
  rows.push(`<button type="button" role="menuitem" data-edit-actions-row="keyboard-shortcuts"><span>Keyboard shortcuts…</span></button>`);
  root.innerHTML =
    `<button type="button" class="edit-actions-button" aria-haspopup="menu" aria-expanded="false">Edit</button>` +
    `<div class="edit-actions-menu" role="menu" aria-label="Edit actions" hidden>${rows.join("")}</div>` +
    `<dialog class="keyboard-reference" aria-labelledby="keyboard-reference-title">${renderKeyboardReference(platform)}<form method="dialog"><button type="submit" class="keyboard-reference-close">Close</button></form></dialog>`;
  toolbar.append(root);

  const button = root.querySelector<HTMLButtonElement>(".edit-actions-button");
  const menu = root.querySelector<HTMLElement>(".edit-actions-menu");
  const dialog = root.querySelector<HTMLDialogElement>(".keyboard-reference");
  if (!button || !menu || !dialog) {
    root.remove();
    return null;
  }

  const closeMenu = (refocus = false) => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
    if (refocus) button.focus();
  };
  const openMenu = () => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
  };

  const runTrigger = (action: EditTriggerAction) => {
    const editor = getEditor();
    if (!editor) return;
    const from = Math.min(editor.selectionStart, editor.selectionEnd);
    const to = Math.max(editor.selectionStart, editor.selectionEnd);
    editor.replaceRange(action.trigger, from, to);
    if (editor.editingMode === "visual") {
      host?.applyVisualAssistInsert?.({ from, to, insert: action.trigger, caret: from + action.trigger.length });
    } else {
      editor.focus();
    }
    field.dispatchEvent(new CustomEvent(ASSIST_TRIGGER_INSERTED_EVENT, { bubbles: true, detail: { trigger: action.trigger } }));
  };

  const runRow = (row: string) => {
    if (row === "keyboard-shortcuts") {
      closeMenu();
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
      dialog.querySelector<HTMLButtonElement>(".keyboard-reference-close")?.focus();
      return;
    }
    if (row === "media") {
      closeMenu();
      mediaButton?.click();
      return;
    }
    const action = available.find((candidate) => `trigger:${candidate.id}` === row);
    closeMenu();
    if (action) runTrigger(action);
  };

  const onButtonClick = () => {
    if (menu.hidden) openMenu();
    else closeMenu();
  };
  // Mousedown (prevented) keeps the native caret and selection inside the
  // projection while the action runs, so the visual pipeline can patch the
  // caret's text. Keyboard and assistive-tech activation arrives as click
  // with detail 0 (no preceding mousedown); real mouse clicks carry
  // detail >= 1 and must not run twice.
  const onRowMouseDown = (event: Event) => {
    const row = (event.target as Element | null)?.closest?.("[data-edit-actions-row]");
    if (!row) return;
    event.preventDefault();
    runRow(row.getAttribute("data-edit-actions-row") ?? "");
  };
  const onRowClick = (event: Event) => {
    if (clickFollowsPointer(event as MouseEvent)) return;
    const row = (event.target as Element | null)?.closest?.("[data-edit-actions-row]");
    if (!row) return;
    runRow(row.getAttribute("data-edit-actions-row") ?? "");
  };
  const onMenuKeydown = (event: Event) => {
    if ((event as KeyboardEvent).key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    }
  };
  const onOutsidePointerDown = (event: Event) => {
    if (menu.hidden) return;
    if ((event.target as Element | null)?.closest?.(".edit-actions")) return;
    closeMenu();
  };
  const onDialogClose = () => button.focus();

  button.addEventListener("click", onButtonClick);
  menu.addEventListener("mousedown", onRowMouseDown);
  menu.addEventListener("click", onRowClick);
  menu.addEventListener("keydown", onMenuKeydown);
  owner.addEventListener("pointerdown", onOutsidePointerDown, true);
  dialog.addEventListener("close", onDialogClose);

  return {
    root,
    dispose() {
      button.removeEventListener("click", onButtonClick);
      menu.removeEventListener("mousedown", onRowMouseDown);
      menu.removeEventListener("click", onRowClick);
      menu.removeEventListener("keydown", onMenuKeydown);
      owner.removeEventListener("pointerdown", onOutsidePointerDown, true);
      dialog.removeEventListener("close", onDialogClose);
      root.remove();
    },
  };
}
