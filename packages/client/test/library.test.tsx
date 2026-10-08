import { test } from "node:test";
import assert from "node:assert/strict";
import { act } from "react";
import type { ElefHost, WorkId, WorkSummary } from "@elef/contracts";
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
    const docMount = previews[0]?.querySelector(
      '[data-controller="document-pages mermaid-diagrams"] > [data-document-pages-target="surface"]',
    );
    assert.ok(docMount, "document previews mount the shared pagination pass");
    assert.equal(
      previews[1]?.querySelector("[data-controller]"),
      null,
      "presentation previews carry no Stimulus mount",
    );
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

test("deleted event forwards host-defined refresh detail opaquely", async () => {
  const host = typedHost();
  await seed(host);
  const notes = { card_notes: { "999": "Parent no longer available · inspiration" } };
  const answering = {
    ...host,
    library: {
      ...host.library,
      deleteWork: async (workId: WorkId) => {
        await host.library.deleteWork(workId);
        return notes;
      },
    },
  };
  const events: unknown[] = [];
  // The Rails adapter is untyped JS and answers refresh info beyond the
  // void contract; reproduce that runtime shape past the static type.
  const { element, shell } = await mountInto(answering as unknown as ElefHost, {
    onLibraryEvent: (event) => events.push(event),
  });
  try {
    await click(element.querySelector("article.library-card .deck-action.danger"));
    assert.equal(events.length, 1);
    const event = events[0] as { type: string; work: WorkSummary; detail: unknown };
    assert.equal(event.type, "deleted");
    assert.equal(event.work.title, "Alpha doc");
    assert.deepEqual(event.detail, notes);
  } finally {
    shell.unmount();
  }
});

test("card previews wait for two frames before loading when a scheduler exists", async () => {
  const scope = globalThis as unknown as Record<string, unknown>;
  assert.equal(
    typeof scope["requestAnimationFrame"],
    "undefined",
    "linkedom must not schedule frames or every preview test needs flushing",
  );
  assert.equal(
    typeof scope["requestIdleCallback"],
    "undefined",
    "linkedom must not schedule idle turns either",
  );
  const frames: Array<(time: number) => void> = [];
  scope["requestAnimationFrame"] = (callback: (time: number) => void): number => {
    frames.push(callback);
    return frames.length;
  };
  const host = typedHost();
  await seed(host);
  const seen: string[] = [];
  const works = host.works as unknown as { getWork: (id: string) => Promise<unknown> };
  const originalGetWork = works.getWork.bind(works);
  works.getWork = async (id: string): Promise<unknown> => {
    seen.push(id);
    return originalGetWork(id);
  };
  try {
    const { shell } = await mountInto(host);
    try {
      await settled();
      assert.deepEqual(seen, [], "no preview fetch before the paint gate releases");
      await act(async () => {
        frames.splice(0).forEach((run) => run(16));
      });
      assert.deepEqual(seen, [], "one frame is not enough");
      await act(async () => {
        frames.splice(0).forEach((run) => run(32));
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      await settled();
      assert.equal(seen.length, 2, "both card previews fetch after two frames");
    } finally {
      shell.unmount();
    }
  } finally {
    delete scope["requestAnimationFrame"];
  }
});

test("card previews wait for an idle turn when a scheduler exists", async () => {
  const scope = globalThis as unknown as Record<string, unknown>;
  const idles: Array<() => void> = [];
  const seenOptions: unknown[] = [];
  scope["requestIdleCallback"] = (callback: () => void, options?: unknown): number => {
    idles.push(callback);
    seenOptions.push(options);
    return idles.length;
  };
  const host = typedHost();
  await seed(host);
  const seen: string[] = [];
  const works = host.works as unknown as { getWork: (id: string) => Promise<unknown> };
  const originalGetWork = works.getWork.bind(works);
  works.getWork = async (id: string): Promise<unknown> => {
    seen.push(id);
    return originalGetWork(id);
  };
  try {
    const { shell } = await mountInto(host);
    try {
      await settled();
      assert.deepEqual(seen, [], "no preview fetch before the idle turn");
      assert.deepEqual(seenOptions, [{ timeout: 1000 }, { timeout: 1000 }]);
      await act(async () => {
        idles.splice(0).forEach((run) => run());
      });
      await settled();
      assert.equal(seen.length, 2, "both card previews fetch after the idle turn");
    } finally {
      shell.unmount();
    }
  } finally {
    delete scope["requestIdleCallback"];
  }
});

test("card previews stand down while hidden and resume on return", async () => {
  const scope = globalThis as unknown as Record<string, unknown>;
  type IOCallback = (entries: ReadonlyArray<{ target: Element; isIntersecting: boolean }>) => void;
  class FakeObserver {
    static instances: FakeObserver[] = [];
    target: Element | null = null;
    disconnected = false;
    private callback: IOCallback;
    constructor(callback: IOCallback) {
      this.callback = callback;
      FakeObserver.instances.push(this);
    }
    observe(target: Element): void {
      this.target = target;
    }
    unobserve(): void {
      this.target = null;
    }
    disconnect(): void {
      this.disconnected = true;
    }
    fire(intersecting: boolean): void {
      if (this.target !== null) this.callback([{ target: this.target, isIntersecting: intersecting }]);
    }
  }
  scope["IntersectionObserver"] = FakeObserver;
  const idles: Array<() => void> = [];
  scope["requestIdleCallback"] = (callback: () => void): number => {
    idles.push(callback);
    return idles.length;
  };
  const host = typedHost();
  await seed(host);
  const seen: string[] = [];
  const works = host.works as unknown as { getWork: (id: string) => Promise<unknown> };
  const originalGetWork = works.getWork.bind(works);
  works.getWork = async (id: string): Promise<unknown> => {
    seen.push(id);
    return originalGetWork(id);
  };
  try {
    const { element, shell } = await mountInto(host);
    try {
      assert.equal(FakeObserver.instances.length, 2, "both cards observe visibility");
      await act(async () => {
        FakeObserver.instances.forEach((observer) => observer.fire(true));
      });
      await act(async () => {
        element.setAttribute("hidden", "");
      });
      await act(async () => {
        idles.splice(0).forEach((run) => run());
      });
      await settled();
      assert.deepEqual(seen, [], "hidden cards never fetch");
      assert.equal(FakeObserver.instances.length, 4, "paused cards resubscribe");
      await act(async () => {
        element.removeAttribute("hidden");
        FakeObserver.instances.slice(2).forEach((observer) => observer.fire(true));
      });
      await act(async () => {
        idles.splice(0).forEach((run) => run());
      });
      await settled();
      assert.equal(seen.length, 2, "both card previews fetch after return");
    } finally {
      shell.unmount();
    }
  } finally {
    delete scope["IntersectionObserver"];
    delete scope["requestIdleCallback"];
  }
});
