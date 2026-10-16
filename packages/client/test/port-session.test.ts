import { test } from "node:test";
import assert from "node:assert/strict";

import type { WorkId, WorkSnapshot, WorksPort } from "@elef/contracts";
import { createPortSession } from "../src/session/port_session.js";

function ws(id: string): WorkId {
  return id as WorkId;
}

function memoryPorts(): WorksPort & { text: { current: string }; revision: { current: string } } {
  const text = { current: "# work\n" };
  const revision = { current: "rev-1" };
  let counter = 1;
  const snapshot = (): WorkSnapshot => ({
    id: ws("work-1"),
    workspaceId: "ws-1" as WorkSnapshot["workspaceId"],
    title: "work",
    kind: "document",
    text: text.current,
    baseline: { revision: revision.current },
  });
  return {
    text,
    revision,
    async getWork() {
      return snapshot();
    },
    async saveWork(_workId, next, baseline) {
      if (baseline.revision !== revision.current) return { kind: "conflict", current: snapshot() };
      counter += 1;
      text.current = next;
      revision.current = `rev-${counter}`;
      return { kind: "saved", baseline: { revision: revision.current } };
    },
  };
}

test("port session opens on the live snapshot and flushes clean", async () => {
  const ports = memoryPorts();
  const session = await createPortSession(ports, ws("work-1"));
  assert.equal(session.workId, "work-1");
  assert.equal(session.kind, "document");
  assert.equal(session.getText(), "# work\n");
  const flushed = await session.flush();
  assert.equal(flushed.kind, "clean");
});

test("port session reports dirty and persists local changes", async () => {
  const ports = memoryPorts();
  const session = await createPortSession(ports, ws("work-1"));
  const seen: string[] = [];
  const off = session.onStatus((status) => seen.push(status.kind));
  session.applyLocalChange({ from: session.getText().length, to: session.getText().length, insert: "More.\n" });
  assert.ok(seen.includes("dirty"));
  const flushed = await session.flush();
  assert.equal(flushed.kind, "saved");
  assert.equal(ports.text.current, "# work\nMore.\n");
  assert.ok(seen.includes("saving"));
  off();
  session.dispose();
});

test("port session surfaces conflicts to external subscribers", async () => {
  const ports = memoryPorts();
  const session = await createPortSession(ports, ws("work-1"));
  const events: WorkSnapshot[] = [];
  session.onExternalChange((snapshot) => events.push(snapshot));
  session.replaceText("stale attempt\n");
  ports.text.current = "# work\n\nOutside.\n";
  ports.revision.current = "rev-outside";
  const flushed = await session.flush();
  assert.equal(flushed.kind, "conflict");
  assert.equal(events.length, 1);
  assert.equal(events[0]?.text, "# work\n\nOutside.\n");
  session.dispose();
});

test("disposed port session fails its flush", async () => {
  const ports = memoryPorts();
  const session = await createPortSession(ports, ws("work-1"));
  session.dispose();
  const flushed = await session.flush();
  assert.equal(flushed.kind, "failed");
});
