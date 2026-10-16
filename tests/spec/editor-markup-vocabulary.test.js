// F10 pin: the server<->client editor-markup vocabulary for the document
// visual editor. The Rails projection (Source::BlockRenderer) writes
// data-editor-*/data-visual-editor-* attributes and visual-editor# Stimulus
// actions; the shared client (document_editor.ts) selects the attributes
// and implements the actions. Renaming either side without the other
// silently breaks visual editing, so this test pins the exact shared set.
// If it fails, update both sides together, then this pin.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const SERVER = "apps/web/app/lib/source/block_renderer.rb";
const CLIENT = "packages/client/src/features/document/document_editor.ts";

const server = readFileSync(path.join(ROOT, SERVER), "utf8");
const client = readFileSync(path.join(ROOT, CLIENT), "utf8");

// Every visual-editor# action the server projection can emit.
const PINNED_ACTIONS = [
  "alignmentChanged",
  "blockBlur",
  "blockFocus",
  "positionControlKeydown",
  "positionControlOpened",
  "projectionInput",
];

// Attribute names written by the server projection and selected by the client.
const PINNED_ATTRIBUTES = ["data-editor-block-id", "data-visual-editor-block-id"];

function serverActions() {
  const found = new Set();
  for (const match of server.matchAll(/visual-editor#([A-Za-z]+)/g)) {
    found.add(match[1]);
  }
  return [...found].sort();
}

function clientDefinesMethod(action) {
  return new RegExp(`^\\s*${action}\\s*\\(`, "m").test(client);
}

test("server emits exactly the pinned visual-editor actions", () => {
  assert.deepEqual(serverActions(), PINNED_ACTIONS);
});

test("client implements every pinned visual-editor action", () => {
  for (const action of PINNED_ACTIONS) {
    assert.equal(
      clientDefinesMethod(action),
      true,
      `${CLIENT} must define ${action}() for ${SERVER}`,
    );
  }
});

test("pinned attributes are written server-side and selected client-side", () => {
  for (const attribute of PINNED_ATTRIBUTES) {
    assert.ok(
      server.includes(attribute),
      `${SERVER} must write ${attribute}`,
    );
    assert.ok(
      client.includes(`[${attribute}]`),
      `${CLIENT} must select [${attribute}]`,
    );
  }
});
