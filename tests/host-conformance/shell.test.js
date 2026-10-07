import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createFakeHost } from "./adapters/fake-host.js";
import { mountElef } from "./shell.js";

test("fake host mounts the client shell with no Rails/Tauri process", async () => {
  const { document } = parseHTML("<html><body><div id=\"app\"></div></body></html>");
  const element = document.getElementById("app");
  const host = createFakeHost();
  await host.library.createWork({
    workspaceId: "ws-1",
    title: "Shell deck",
    kind: "document",
    text: "# Shell deck\n",
  });
  const shell = await mountElef(element, host, {});
  try {
    const items = element.querySelectorAll("li");
    assert.equal(items.length, 1, "shell lists the fake work");
    assert.match(items[0].textContent, /Shell deck/, "shell shows the work title");
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
  const { document } = parseHTML("<html><body><div id=\"app\"></div></body></html>");
  const element = document.getElementById("app");
  const host = createFakeHost();
  host.capabilities = { ...host.capabilities, updater: true };
  const shell = await mountElef(element, host, {});
  try {
    assert.ok(element.querySelector("[data-elef-updates]"), "updater affordance appears");
  } finally {
    shell.unmount();
  }
});
