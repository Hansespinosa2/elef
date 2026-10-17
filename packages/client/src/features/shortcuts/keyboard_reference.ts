// Keyboard reference content: the registry rendered as dialog rows plus the
// static editor-trigger vocabulary. Lives with the shortcut registry (same
// feature slice); the Edit-actions menu in session/ receives it injected so
// no feature boundary is crossed.
import { SHORTCUT_ACTIONS, chordDisplay } from "./shortcuts.js";

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

function actionChip(action: { webChord: string | null; desktopChord: string | null; palette: boolean }, platform: "mac" | "other"): string {
  const chord = action.webChord ?? action.desktopChord;
  if (chord) return `<kbd>${chordDisplay(chord, platform)}</kbd>`;
  return action.palette ? `<span class="keyboard-reference-palette-tag">Palette</span>` : "";
}

export interface KeyboardReferenceBlockKeys {
  readonly keys: string;
  readonly description: string;
}

export const KEYBOARD_REFERENCE_BLOCKS: readonly KeyboardReferenceBlockKeys[] = Object.freeze([
  Object.freeze({ keys: "Enter", description: "Split the block, or open a new block below at block end" }),
  Object.freeze({ keys: "Backspace", description: "Delete the empty block" }),
  Object.freeze({ keys: "Alt+↑ / Alt+↓", description: "Move the block up or down" }),
]);

export function renderKeyboardReference(platform: "mac" | "other", options: { blocks?: boolean } = {}): string {
  const globalRows = SHORTCUT_ACTIONS.map((action) =>
    `<li><span class="keyboard-reference-keys">${actionChip(action, platform)}</span><span class="keyboard-reference-label">${action.label}</span><span class="keyboard-reference-description">${action.description}</span></li>`,
  ).join("");
  const triggerRows = KEYBOARD_REFERENCE_TRIGGERS.map((trigger) =>
    `<li><span class="keyboard-reference-keys"><kbd>${trigger.keys}</kbd></span><span class="keyboard-reference-description">${trigger.description}</span></li>`,
  ).join("");
  const blockRows = KEYBOARD_REFERENCE_BLOCKS.map((entry) =>
    `<li><span class="keyboard-reference-keys"><kbd>${entry.keys}</kbd></span><span class="keyboard-reference-description">${entry.description}</span></li>`,
  ).join("");
  const blocksSection = options.blocks === true
    ? `<h3>Slide blocks</h3><ul class="keyboard-reference-list">${blockRows}</ul>`
    : "";
  return `<h2 id="keyboard-reference-title">Keyboard shortcuts</h2>` +
    `<p class="keyboard-reference-lede">Visual and source modes share every shortcut. Global chords need ⌘/Ctrl, so Vim normal mode never collides with them.</p>` +
    `<h3>Global</h3><ul class="keyboard-reference-list">${globalRows}</ul>` +
    `<h3>Editor triggers</h3><ul class="keyboard-reference-list">${triggerRows}</ul>` +
    blocksSection +
    `<p class="keyboard-reference-lede">Vim motions, operators, and text objects work in both modes; toggle Vim mode from the command palette.</p>`;
}
