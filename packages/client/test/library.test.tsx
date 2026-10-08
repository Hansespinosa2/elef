import { test } from "node:test";
import assert from "node:assert/strict";
import type { WorkSummary } from "@elef/contracts";
import { CREATE_WORK_EVENT } from "../src/features/library/LibraryApp.js";
import type { ElefMountOptions } from "../src/index.js";
import {
  click,
  mountInto,
  setInputValue,
  setSearchInput,
  settled,
  submitForm,
  typedHost,
  ws,
} from "./helpers.js";

async function seed(host: ReturnType<typeof typedHost>) {
  await host.library.createWork({
    workspaceId: ws("ws-1"),
    title: "Alpha doc",
    kind: "document",
    text: "# Alpha\n\nBody text.\n",
  });
  await host.library.createWork({
    workspaceId: ws("ws-1"),
    title: "Beta deck",
    kind: "presentation",
    text: "# Beta\n\nSlide text.\n",
  });
}

function titles(element: Element): string[] {
  return [...element.querySelectorAll(".library-card-title")].map(
    (node) => node.textContent?.trim() ?? "",
  );
}

test("library tabs filter by kind and navigate through the host seam", async () => {
  const host = typedHost();
  await seed(host);
  const seen: unknown[] = [];
  const options: ElefMountOptions = { navigate: (target) => seen.push(target) };
  const { element, shell } = await mountInto(host, options);
  try {
    assert.deepEqual(titles(element), ["Alpha doc", "Beta deck"]);
    await click(element.querySelector('[data-library-tab="presentations"]'));
    assert.deepEqual(titles(element), ["Beta deck"]);
    assert.deepEqual(seen, [{ url: "#library/presentations" }]);
    await click(element.querySelector('[data-library-tab="documents"]'));
    assert.deepEqual(titles(element), ["Alpha doc"]);
  } finally {
    shell.unmount();
  }
});

test("search box filters cards client-side with a no-results state", async () => {
  const host = typedHost();
  await seed(host);
  await host.library.createWork({
    workspaceId: ws("ws-1"),
    title: "Café Deck",
    kind: "presentation",
    text: "# Café Deck\n",
  });
  const { element, shell } = await mountInto(host);
  try {
    await setSearchInput(element.querySelector("#library-search"), "BETA");
    assert.deepEqual(titles(element), ["Beta deck"]);
    await setSearchInput(element.querySelector("#library-search"), "CAFÉ");
    assert.deepEqual(titles(element), ["Café Deck"], "search ignores case and canonical Unicode differences");
    assert.match(
      element.querySelector("#library-count")?.textContent ?? "",
      /3 works · 1 shown/,
      "count names the filter total and the shown subset",
    );
    await setSearchInput(element.querySelector("#library-search"), "zzz-no-match");
    assert.equal(element.querySelectorAll("article.library-card").length, 0);
    assert.equal(
      (element.querySelector("#library-no-results") as unknown as { hidden: boolean }).hidden,
      false,
      "no-results state appears",
    );
  } finally {
    shell.unmount();
  }
});

test("create dialog creates through the port and opens the new work", async () => {
  const host = typedHost();
  const seen: unknown[] = [];
  const { element, shell } = await mountInto(host, { navigate: (target) => seen.push(target) });
  try {
    const root = element.querySelector("[data-elef-shell]") as unknown as {
      ownerDocument: Document;
      dispatchEvent: (event: unknown) => void;
    };
    const event = root.ownerDocument.createEvent("CustomEvent");
    (event as unknown as { initCustomEvent: (t: string, b: boolean, c: boolean, d: unknown) => void }).initCustomEvent(
      CREATE_WORK_EVENT,
      true,
      false,
      { kind: "document" },
    );
    root.dispatchEvent(event);
    await settled();
    await setInputValue(element.querySelector("#new-deck-name"), "Fresh work");
    await submitForm(element.querySelector("#create-form"));
    assert.deepEqual(titles(element), ["Fresh work"]);
    assert.equal(seen.length, 1, "new work opens after create");
    const target = seen[0] as { workId: string };
    const works = await host.library.listWorks(ws("ws-1"));
    assert.ok(works.some((work) => work.id === target.workId));
  } finally {
    shell.unmount();
  }
});

test("rename form renames through the port and refreshes the card", async () => {
  const host = typedHost();
  await seed(host);
  const options: ElefMountOptions = {
    operationNotice: (operation, work) =>
      `${work.kind === "document" ? "Document" : "Presentation"} ${operation}.`,
  };
  const { element, shell } = await mountInto(host, options);
  try {
    await setInputValue(element.querySelector(".library-rename input"), "Renamed doc");
    await submitForm(element.querySelector(".library-rename"));
    assert.deepEqual(titles(element), ["Renamed doc", "Beta deck"]);
    const works = await host.library.listWorks(ws("ws-1"));
    assert.ok(works.some((work) => work.title === "Renamed doc"));
    assert.equal(
      element.querySelector("#notice")?.textContent,
      "Document renamed.",
      "host notice renders after rename",
    );
    const card = element.querySelector("article.library-card");
    assert.match(
      card?.getAttribute("id") ?? "",
      /^document_/,
      "card keeps the kind-prefixed DOM id",
    );
  } finally {
    shell.unmount();
  }
});

test("delete honors the host confirm seam before calling the port", async () => {
  const host = typedHost();
  await seed(host);
  let confirmations = 0;
  const events: { type: string; title: string }[] = [];
  const options: ElefMountOptions = {
    confirmDelete: () => {
      confirmations += 1;
      return confirmations > 1;
    },
    onLibraryEvent: (event) => events.push({ type: event.type, title: event.work.title }),
  };
  const { element, shell } = await mountInto(host, options);
  try {
    await click(element.querySelector("article.library-card .deck-action.danger"));
    assert.deepEqual(titles(element), ["Alpha doc", "Beta deck"], "declined delete keeps the work");
    await click(element.querySelector("article.library-card .deck-action.danger"));
    assert.deepEqual(titles(element), ["Beta deck"], "confirmed delete removes the work");
    const works = await host.library.listWorks(ws("ws-1"));
    assert.equal(works.length, 1);
    assert.deepEqual(events, [{ type: "deleted", title: "Alpha doc" }], "host observes the delete");
  } finally {
    shell.unmount();
  }
});

test("a cancelled delete is silent and keeps the work", async () => {
  const host = typedHost();
  await seed(host);
  const events: string[] = [];
  const rejecting = {
    ...host,
    library: {
      ...host.library,
      deleteWork: async () => {
        throw { code: "cancelled", message: "The deletion was cancelled.", retryable: false };
      },
    },
  };
  const { element, shell } = await mountInto(rejecting, {
    onLibraryEvent: (event) => events.push(event.type),
  });
  try {
    await click(element.querySelector("article.library-card .deck-action.danger"));
    assert.deepEqual(titles(element), ["Alpha doc", "Beta deck"], "cancelled delete keeps the work");
    assert.deepEqual(events, [], "no library event fires for a cancellation");
    const notice = element.querySelector("#notice") as unknown as { hidden: boolean };
    assert.equal(notice.hidden, true, "no notice is shown for a cancellation");
  } finally {
    shell.unmount();
  }
});

test("shell notify surfaces host notices with tone on #notice", async () => {
  const host = typedHost();
  await seed(host);
  const { element, shell } = await mountInto(host);
  try {
    const notice = () => element.querySelector("#notice") as unknown as {
      hidden: boolean;
      textContent: string | null;
      dataset: { tone?: string };
    };
    assert.equal(notice().hidden, true);
    shell.notify("The operation could not be completed.", "error");
    assert.equal(notice().hidden, false);
    assert.equal(notice().textContent, "The operation could not be completed.");
    assert.equal(notice().dataset.tone, "error");
    shell.notify(null);
    assert.equal(notice().hidden, true);
  } finally {
    shell.unmount();
  }
});

test("shell setFilter switches tabs synchronously", async () => {
  const host = typedHost();
  await seed(host);
  const { element, shell } = await mountInto(host);
  try {
    shell.setFilter("documents");
    assert.deepEqual(titles(element), ["Alpha doc"]);
    const active = element.querySelector("#show-documents") as unknown as {
      classList: { contains(name: string): boolean };
      getAttribute(name: string): string | null;
    };
    assert.equal(active.classList.contains("is-active"), true);
    assert.equal(active.getAttribute("aria-current"), "page");
  } finally {
    shell.unmount();
  }
});

test("shell refresh reloads data while preserving UI state", async () => {
  const host = typedHost();
  await seed(host);
  const { element, shell } = await mountInto(host, { initialUrl: "https://host.test/#library/documents" });
  try {
    await host.library.createWork({ workspaceId: ws("ws-1"), title: "Late doc", kind: "document" });
    await shell.refresh();
    await settled();
    assert.deepEqual(titles(element), ["Alpha doc", "Late doc"], "refresh picks up new works");
  } finally {
    shell.unmount();
  }
});

test("card previews render sanitized renderer output", async () => {
  const host = typedHost();
  await seed(host);
  await host.library.createWork({
    workspaceId: ws("ws-1"),
    title: "Hostile doc",
    kind: "document",
    text: "# Hostile\n\n<script>evil()</script>\n\n[bad](javascript:evil())\n\n![remote](https://example.com/remote.png)\n",
  });
  const { element, shell } = await mountInto(host);
  try {
    await settled();
    const previews = element.querySelectorAll(".library-card-preview");
    assert.equal(previews.length, 3);
    assert.match(previews[0]?.textContent ?? "", /Alpha/, "document preview renders the source");
    assert.match(previews[1]?.textContent ?? "", /Beta/, "presentation preview renders the source");
    const hostile = previews[2]?.innerHTML ?? "";
    assert.equal(previews[2]?.querySelector("script"), null, "scripts never reach the card DOM");
    assert.match(hostile, /Hostile/, "safe content survives");
    assert.doesNotMatch(hostile, /javascript:/, "javascript URLs are stripped");
    assert.doesNotMatch(hostile, /example\.com/, "remote media is stripped without a media base");
    for (const preview of previews) {
      assert.equal(
        (preview as unknown as { dataset: { previewState?: string } }).dataset.previewState,
        "ready",
        "rendered previews report ready on the card preview node",
      );
    }
  } finally {
    shell.unmount();
  }
});

test("list renders in batches of 48 with a load-more control", async () => {
  const host = typedHost();
  for (let i = 0; i < 50; i += 1) {
    await host.library.createWork({
      workspaceId: ws("ws-1"),
      title: `Work ${String(i).padStart(2, "0")}`,
      kind: i % 2 === 0 ? "document" : "presentation",
    });
  }
  const { element, shell } = await mountInto(host);
  try {
    assert.equal(element.querySelectorAll("article.library-card").length, 48);
    const more = element.querySelector("#library-load-more") as unknown as { hidden: boolean };
    assert.equal(more.hidden, false, "load-more appears past the first batch");
    await click(element.querySelector("#library-load-more"));
    assert.equal(element.querySelectorAll("article.library-card").length, 50);
  } finally {
    shell.unmount();
  }
});

test("empty library invites creation for the active filter", async () => {
  const host = typedHost();
  const { element, shell } = await mountInto(host, { initialUrl: "/documents" });
  try {
    const empty = element.querySelector("#empty-library") as unknown as { hidden: boolean };
    assert.equal(empty.hidden, false, "empty state appears with no works");
    assert.match(
      element.querySelector("[data-library-empty-title]")?.textContent ?? "",
      /No documents yet/,
    );
    await click(element.querySelector("#empty-library button"));
    const dialog = element.querySelector("#create-dialog") as unknown as {
      getAttribute: (name: string) => string | null;
      hasAttribute: (name: string) => boolean;
    };
    assert.ok(
      dialog.hasAttribute("open"),
      "empty-state action opens the create dialog",
    );
    assert.equal(
      (element.querySelector("#new-deck-kind") as unknown as { value: string }).value,
      "document",
      "dialog inherits the active filter kind",
    );
  } finally {
    shell.unmount();
  }
});

test("present button and host extras appear only when the host provides them", async () => {
  const host = typedHost();
  await seed(host);
  const presented: WorkSummary[] = [];
  const options: ElefMountOptions = {
    presentWork: (work) => presented.push(work),
    cardNote: (work) => (work.kind === "presentation" ? "Forked from Outline" : null),
    extraCardActions: (work) =>
      work.kind === "presentation"
        ? [
            {
              label: "Fork",
              menuClass: "library-card-submenu fork-menu",
              children: [
                { label: "As continuation", run: () => {} },
                { label: "As inspiration", run: () => {} },
              ],
            },
          ]
        : [],
  };
  const { element, shell } = await mountInto(host, options);
  try {
    const cards = element.querySelectorAll("article.library-card");
    assert.equal(cards.length, 2);
    const presentButtons = [...element.querySelectorAll(".library-card-menu-options .deck-action")].filter(
      (node) => node.textContent?.trim() === "Present",
    );
    assert.equal(presentButtons.length, 1, "only presentations offer Present");
    await click(presentButtons[0]);
    assert.equal(presented.length, 1);
    assert.match(element.textContent ?? "", /Forked from Outline/, "host card note renders");
    const forkMenu = element.querySelector(".fork-menu");
    assert.ok(forkMenu, "host submenu renders with its menu class");
    assert.match(forkMenu?.textContent ?? "", /As continuation/);
    assert.match(forkMenu?.textContent ?? "", /As inspiration/);
  } finally {
    shell.unmount();
  }
});
