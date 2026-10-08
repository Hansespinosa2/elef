import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { act } from "react";
import { createFakeHost } from "../../../tests/host-conformance/adapters/fake-host.js";
import { mountElef } from "../src/index.js";
import type { ElefHost, ElefMountOptions } from "../src/index.js";
import type { WorkspaceId } from "@elef/contracts";

function typedHost(): ElefHost {
  return createFakeHost() as unknown as ElefHost;
}

function ws(id: string): WorkspaceId {
  return id as WorkspaceId;
}

async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

async function mountInto(
  host: ElefHost,
  options: ElefMountOptions = {},
) {
  const { document } = parseHTML('<html><body><div id="app"></div></body></html>');
  const view = (document as unknown as { defaultView?: unknown }).defaultView;
  (globalThis as Record<string, unknown>)["window"] = view ?? { document };
  (globalThis as Record<string, unknown>)["document"] = document;
  if ((globalThis as Record<string, unknown>)["navigator"] === undefined) {
    (globalThis as Record<string, unknown>)["navigator"] = { userAgent: "node" };
  }
  const element = document.getElementById("app") as unknown as HTMLElement;
  let shell: Awaited<ReturnType<typeof mountElef>> | undefined;
  await act(async () => {
    shell = await mountElef(element, host, options);
  });
  await settled();
  return { document, element, shell: shell as Awaited<ReturnType<typeof mountElef>> };
}

test("fake host mounts the client shell with no Rails/Tauri process", async () => {
  const host = typedHost();
  await host.library.createWork({
    workspaceId: ws("ws-1"),
    title: "Shell deck",
    kind: "document",
    text: "# Shell deck\n",
  });
  const { element, shell } = await mountInto(host);
  try {
    const items = element.querySelectorAll("li");
    assert.equal(items.length, 1, "shell lists the fake work");
    const first = items[0];
    assert.ok(first, "first item exists");
    assert.match(first.textContent ?? "", /Shell deck/, "shell shows the work title");
    assert.equal(
      element.querySelector("[data-elef-updates]"),
      null,
      "shell hides updater affordance when the capability is false",
    );
  } finally {
    shell.unmount();
  }
  assert.equal(element.querySelector("[data-elef-shell]"), null, "unmount removes the shell");
});

test("shell gates native affordances on capabilities, not host names", async () => {
  const host = typedHost();
  host.capabilities = { ...host.capabilities, updater: true };
  const { element, shell } = await mountInto(host);
  try {
    assert.ok(element.querySelector("[data-elef-updates]"), "updater affordance appears");
  } finally {
    shell.unmount();
  }
});

test("initialUrl selects the library filter", async () => {
  const host = typedHost();
  await host.library.createWork({ workspaceId: ws("ws-1"), title: "Doc", kind: "document" });
  await host.library.createWork({ workspaceId: ws("ws-1"), title: "Deck", kind: "presentation" });
  const { element, shell } = await mountInto(host, { initialUrl: "/documents" });
  try {
    const items = element.querySelectorAll("li");
    assert.equal(items.length, 1, "only documents shown");
    const only = items[0];
    assert.ok(only, "only item exists");
    assert.match(only.textContent ?? "", /Doc/, "the document is shown");
  } finally {
    shell.unmount();
  }
});

test("opening a work calls the host navigate seam with the work id", async () => {
  const host = typedHost();
  const created = await host.library.createWork({
    workspaceId: ws("ws-1"),
    title: "Open me",
    kind: "document",
  });
  const seen: unknown[] = [];
  const { element, shell } = await mountInto(host, { navigate: (target: unknown) => seen.push(target) });
  try {
    const button = element.querySelector("li button") as unknown as { click: () => void };
    await act(async () => {
      button.click();
    });
    assert.deepEqual(seen, [{ workId: created.id }]);
  } finally {
    shell.unmount();
  }
});
