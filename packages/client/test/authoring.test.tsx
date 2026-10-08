import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { parseHTML } from "linkedom";
import { AuthoringDialog } from "../src/features/settings/AuthoringDialog.js";
import type {
  AuthoringRegistryTransport,
  MathShortcutEntry,
  SnippetEntry,
} from "../src/features/settings/authoringRegistry.js";
import {
  buildAuthoringEntry,
  filterAuthoringEntries,
  mathExample,
  removeAuthoringEntry,
  snippetExample,
  sortedEntries,
  upsertAuthoringEntry,
} from "../src/features/settings/authoringRegistry.js";
import { click, settled, submitForm } from "./helpers.js";

// React skips onChange when the DOM value is assigned through its own
// tracked setter (no diff vs the controlled prop): bypass the tracker with
// the native prototype setter so the input event carries a real change,
// exactly like a user keystroke.
async function setControlledInput(input: unknown, value: string): Promise<void> {
  const node = input as {
    ownerDocument: Document;
    dispatchEvent: (event: unknown) => void;
  };
  let proto: object | null = Object.getPrototypeOf(node);
  while (proto !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
    if (descriptor?.set) {
      descriptor.set.call(node, value);
      break;
    }
    proto = Object.getPrototypeOf(proto);
  }
  const event = node.ownerDocument.createEvent("Event");
  event.initEvent("input", true, true);
  await act(async () => {
    node.dispatchEvent(event);
  });
  await settled();
}

async function mountDialog(props: Parameters<typeof AuthoringDialog>[0]) {
  const { document } = parseHTML("<html><body><div id=\"app\"></div></body></html>");
  const view = (document as unknown as { defaultView?: unknown }).defaultView;
  (globalThis as Record<string, unknown>)["window"] = view ?? { document };
  (globalThis as Record<string, unknown>)["document"] = document;
  if ((globalThis as Record<string, unknown>)["navigator"] === undefined) {
    (globalThis as Record<string, unknown>)["navigator"] = { userAgent: "node" };
  }
  const element = document.getElementById("app") as unknown as HTMLElement;
  const { createElement } = await import("react");
  await act(async () => {
    createRoot(element).render(createElement(AuthoringDialog, props));
  });
  await settled();
  return { document };
}

interface MemoryBacking {
  snippets: SnippetEntry[];
  math: MathShortcutEntry[];
  hashes: { snippets: string | null; math_shortcuts: string | null };
}

type WritePayload = Parameters<AuthoringRegistryTransport["writeRegistry"]>[0];
type WriteResult = Awaited<ReturnType<AuthoringRegistryTransport["writeRegistry"]>>;

function memoryTransport(
  backing: MemoryBacking,
  hooks: {
    onWrite?: (payload: WritePayload) => unknown;
    reloads?: { count: number };
    saved?: string[];
  } = {},
): AuthoringRegistryTransport {
  return {
    readRegistries: async () => ({
      snippets: [...backing.snippets],
      math_shortcuts: [...backing.math],
      hashes: { ...backing.hashes },
    }),
    writeRegistry: async (payload) => {
      const extra = hooks.onWrite ? await hooks.onWrite(payload) : undefined;
      return (extra ?? { contentHash: null }) as WriteResult;
    },
  };
}

describe("authoring registry semantics", () => {
  it("validates snippet and shortcut entries like the editor surfaces", () => {
    const snippet = buildAuthoringEntry(
      "snippets",
      { name: "Note", trigger: "note", category: "Markdown", body: "# Note", description: "" },
      "personal-1",
    );
    assert.equal(snippet.trigger, "note");
    assert.throws(
      () => buildAuthoringEntry("snippets", { name: "Bad", trigger: "UPPER", category: "Markdown", body: "x" }, "id"),
      /lowercase/,
    );
    const shortcut = buildAuthoringEntry(
      "math_shortcuts",
      { name: "Lambda", prefix: "@", aliases: "Lambda, l", expansion: "\\lambda" },
      "personal-2",
    );
    assert.deepEqual(shortcut.aliases, ["lambda", "l"]);
    assert.throws(
      () => buildAuthoringEntry("math_shortcuts", { name: "Bad", prefix: "!", aliases: "x", expansion: "y" }, "id"),
      /prefix/,
    );
  });

  it("upserts, removes, orders and filters entries", () => {
    const first = buildAuthoringEntry(
      "snippets",
      { name: "Zebra", trigger: "zebra", category: "Mermaid", body: "z" },
      "a",
    );
    const second = buildAuthoringEntry(
      "snippets",
      { name: "Apple", trigger: "apple", category: "Markdown", body: "a" },
      "b",
    );
    let entries = upsertAuthoringEntry([], first);
    entries = upsertAuthoringEntry(entries, second);
    assert.deepEqual(
      sortedEntries(entries, "snippets").map((entry) => entry.id),
      ["b", "a"],
    );
    entries = upsertAuthoringEntry(entries, { ...second, name: "Apricot" });
    assert.equal(entries.length, 2);
    assert.deepEqual(
      filterAuthoringEntries(entries, "apricot", "", "snippets").map((entry) => entry.id),
      ["b"],
    );
    assert.deepEqual(
      filterAuthoringEntries(entries, "", "Mermaid", "snippets").map((entry) => entry.id),
      ["a"],
    );
    assert.deepEqual(
      removeAuthoringEntry(entries, "b").map((entry) => entry.id),
      ["a"],
    );
  });

  it("renders template and expansion examples", () => {
    assert.equal(snippetExample("**${1:text}**"), "**text**");
    assert.equal(snippetExample("plain"), "plain");
    assert.equal(mathExample("\\frac{${1:a}}{${2:b}}"), "\\frac{x}{x}");
  });
});

describe("authoring dialog", () => {
  it("exposes built-ins as read-only and filters entries by type and search", async () => {
    const { document } = await mountDialog({
      transport: memoryTransport({
        snippets: [
          { id: "builtin", name: "Bold", trigger: "bold", category: "Markdown", body: "**${1:text}**", built_in: true },
          { id: "personal", name: "Note", trigger: "note", category: "Markdown", body: "# ${1:Note}", built_in: false },
        ],
        math: [],
        hashes: { snippets: "snippets-hash", math_shortcuts: null },
      }),
    });

    assert.equal(document.querySelector("#authoring-settings-count")?.textContent, "2 snippets · 1 personal");
    assert.equal(document.querySelectorAll(".snippet-card").length, 2);
    const cards = [...document.querySelectorAll(".authoring-entry-card")];
    const builtin = cards.find((card) => (card.textContent ?? "").includes("Bold"));
    assert.equal(builtin?.querySelector(".authoring-entry-actions"), null);

    const search = document.querySelector("#authoring-settings-search") as unknown;
    await setControlledInput(search, "note");
    assert.equal(document.querySelectorAll(".snippet-card").length, 1);
    assert.match(document.querySelector(".authoring-entry-card")?.textContent ?? "", /Note/);

    const tabs = [...document.querySelectorAll('[data-authoring-tab]')];
    await click(tabs.find((tab) => tab.getAttribute("data-authoring-tab") === "math_shortcuts"));
    assert.equal(document.querySelector("#authoring-settings-title")?.textContent, "Math shortcuts");
    assert.equal(document.querySelector("#authoring-settings-category"), null);
  });

  it("edits and deletes through the injected transport with the hash handshake", async () => {
    const writes: { registry: string; baseHash?: string | null; entries: { aliases?: readonly string[] }[] }[] = [];
    const saved: string[] = [];
    let reloads = 0;
    const { document } = await mountDialog({
      transport: memoryTransport(
        {
          snippets: [
            { id: "default-bold", name: "Bold", trigger: "bold", category: "Markdown", body: "**${1:text}**", built_in: true },
            { id: "snippet-1", name: "Note", trigger: "note", category: "Markdown", body: "# Note", built_in: false },
          ],
          math: [{ id: "math-1", name: "Lambda", prefix: "@", aliases: ["lam"], expansion: "\\lambda", built_in: false }],
          hashes: { snippets: "snippets-hash", math_shortcuts: "math-hash" },
        },
        {
          onWrite: (payload) => {
            writes.push(payload as unknown as (typeof writes)[number]);
            return { contentHash: `hash-${writes.length}` };
          },
          saved,
        },
      ),
      initialRegistry: "math_shortcuts",
      reloadEditorRegistry: async () => {
        reloads += 1;
      },
      onSaved: (message) => {
        saved.push(message);
      },
    });

    assert.equal(document.querySelector("#authoring-settings-count")?.textContent, "1 math shortcut · 1 personal");
    const editButton = document.querySelector(".authoring-entry-actions button:not(.authoring-delete)") as unknown;
    await click(editButton);
    const aliases = document.querySelector('[name="aliases"]') as unknown;
    await setControlledInput(aliases, "Lambda, l");
    await submitForm(document.querySelector("#authoring-entry-form") as unknown);
    const firstWrite = writes[0];
    assert.notEqual(firstWrite, undefined);
    assert.equal(firstWrite?.registry, "math_shortcuts");
    assert.equal(firstWrite?.baseHash, "math-hash");
    assert.equal(firstWrite?.entries.length, 1);
    assert.deepEqual(firstWrite?.entries[0]?.aliases, ["lambda", "l"]);
    assert.equal(reloads, 1);
    assert.deepEqual(saved, ["Changes saved"]);

    await click(document.querySelector(".authoring-delete") as unknown);
    assert.match(document.querySelector("#delete-authoring-message")?.textContent ?? "", /Delete “Lambda”/);
    await click(document.querySelector("#confirm-authoring-delete") as unknown);
    assert.deepEqual(writes[1]?.entries, []);
    assert.deepEqual(saved, ["Changes saved", "Entry deletion saved"]);
    assert.equal(reloads, 2);
  });

  it("serializes rapid submits so one new entry creates only one record", async () => {
    const writes: unknown[] = [];
    let finishWrite!: () => void;
    const pendingWrite = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    const { document } = await mountDialog({
      transport: memoryTransport(
        { snippets: [], math: [], hashes: { snippets: null, math_shortcuts: null } },
        {
          onWrite: async (payload) => {
            writes.push(payload);
            await pendingWrite;
            return {
              entries: (payload.entries as unknown as Record<string, unknown>[]).map((entry) => ({
                ...entry,
                id: 42,
              })),
            };
          },
        },
      ),
      initialRegistry: "snippets",
      openNew: true,
    });

    await setControlledInput(document.querySelector('[name="name"]') as unknown, "Rapid submit");
    await setControlledInput(document.querySelector('[name="trigger"]') as unknown, "rapid-submit");
    await setControlledInput(document.querySelector('[name="body"]') as unknown, "**${1:text}**");
    const form = document.querySelector("#authoring-entry-form") as unknown as {
      ownerDocument: Document;
      dispatchEvent: (event: unknown) => void;
    };
    await act(async () => {
      const first = form.ownerDocument.createEvent("Event");
      first.initEvent("submit", true, true);
      form.dispatchEvent(first);
      const second = form.ownerDocument.createEvent("Event");
      second.initEvent("submit", true, true);
      form.dispatchEvent(second);
    });
    await settled();

    assert.equal(writes.length, 1);
    assert.equal((document.querySelector("#save-authoring-entry") as unknown as { disabled: boolean }).disabled, true);
    finishWrite();
    await settled();
    assert.equal((document.querySelector("#save-authoring-entry") as unknown as { disabled: boolean } | null), null);
    assert.equal(document.querySelectorAll(".authoring-entry-card").length, 1);
  });

  it("sanitizes renderer output in example previews", async () => {
    const { document } = await mountDialog({
      transport: memoryTransport({
        snippets: [{ id: "snippet-1", name: "Note", trigger: "note", category: "Markdown", body: "# ${1:Note}", built_in: false }],
        math: [],
        hashes: { snippets: null, math_shortcuts: null },
      }),
      renderExample: () => '<p class="preview">safe</p><script>unsafe()</script>',
    });
    await settled();
    const preview = document.querySelector(".snippet-example-preview");
    assert.equal(preview?.textContent, "safe");
    assert.equal(preview?.querySelector("script"), null);
  });

  it("shows a safe conflict message without leaking transport detail", async () => {
    const { document } = await mountDialog({
      transport: memoryTransport(
        {
          snippets: [],
          math: [{ id: "math-1", name: "Lambda", prefix: "@", aliases: ["lam"], expansion: "\\lambda", built_in: false }],
          hashes: { snippets: null, math_shortcuts: "math-hash" },
        },
        {
          onWrite: () => {
            throw Object.assign(new Error("private filesystem detail"), { code: "conflict" });
          },
        },
      ),
      initialRegistry: "math_shortcuts",
    });

    await click(document.querySelector(".authoring-entry-actions button:not(.authoring-delete)") as unknown);
    await submitForm(document.querySelector("#authoring-entry-form") as unknown);
    const message = document.querySelector("#authoring-settings-status")?.textContent ?? "";
    assert.match(message, /settings changed outside Elef/);
    assert.doesNotMatch(message, /private filesystem detail/);
  });

  it("keeps the load failure visible without leaking transport detail", async () => {
    const failing: AuthoringRegistryTransport = {
      readRegistries: async () => {
        throw new Error("private transport detail");
      },
      writeRegistry: async () => ({ contentHash: null }),
    };
    const { document } = await mountDialog({ transport: failing });
    const message = document.querySelector("#authoring-settings-status")?.textContent ?? "";
    assert.match(message, /Could not load authoring settings/);
    assert.doesNotMatch(message, /private transport detail/);
  });
});
