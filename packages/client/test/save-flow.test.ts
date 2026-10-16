import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { createSaveFlow } from "../src/session/save_flow.js";
import type {
  ExternalSnapshot,
  MergeOutcome,
  SaveFlow,
  SaveWork,
} from "../src/session/save_flow.js";

const sha = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

interface Harness {
  flow: SaveFlow;
  work: SaveWork;
  disk: { source: string };
  setEditor: (source: string) => void;
  saves: Array<{ source: string; base: string }>;
  snapshots: Array<{ id: string; reason: string }>;
  mergeCalls: string[];
  setSourceCalls: string[];
  conflicts: unknown[];
  errors: unknown[];
  snapshotGate: ReturnType<typeof deferred>;
  mergeGate: ReturnType<typeof deferred>;
  staleSnapshot: ExternalSnapshot;
}

const BEFORE = "# Before E2E\n\nSeed paragraph.\n";
const AFTER = "# Before E2E\n\nSeed paragraph.\n\nEdited.\n";

function setup(): Harness {
  let editor = BEFORE;
  const disk = { source: BEFORE };
  const work: SaveWork = {
    id: "work-1",
    content_hash: sha(BEFORE),
    source: BEFORE,
    savedSnapshot: BEFORE,
  };
  const saves: Harness["saves"] = [];
  const snapshots: Harness["snapshots"] = [];
  const mergeCalls: string[] = [];
  const setSourceCalls: string[] = [];
  const conflicts: unknown[] = [];
  const errors: unknown[] = [];
  const snapshotGate = deferred();
  const mergeGate = deferred();
  const flow = createSaveFlow({
    saveDelay: 3_600_000,
    getSource: () => editor,
    setSource: (source: string): boolean => {
      setSourceCalls.push(source);
      editor = source;
      return true;
    },
    // Faithful backend: the write commits only when the caller's base
    // matches the bytes on disk, else it throws a conflict failure.
    saveSource: async (id: string, source: string) => {
      void id;
      const base = work.content_hash;
      if (sha(disk.source) !== base) {
        throw {
          code: "conflict",
          details: {
            disk_hash: sha(disk.source),
            current: { source: disk.source },
          },
        };
      }
      disk.source = source;
      saves.push({ source, base });
      return { content_hash: sha(source) };
    },
    acceptDiskVersion: () => {},
    takeSnapshot: async (id: string, reason: string): Promise<unknown> => {
      snapshots.push({ id, reason });
      await snapshotGate.promise;
      return {};
    },
    mergeExternalChange: async (
      id: string,
      localSource: string
    ): Promise<MergeOutcome | null | undefined> => {
      void id;
      mergeCalls.push(localSource);
      await mergeGate.promise;
      return { kind: "merged", source: localSource };
    },
    onConflict: (conflict: unknown) => {
      conflicts.push(conflict);
    },
    onError: (error: unknown) => {
      errors.push(error);
    },
  });
  return {
    flow,
    work,
    disk,
    setEditor: (source: string) => {
      editor = source;
    },
    saves,
    snapshots,
    mergeCalls,
    setSourceCalls,
    conflicts,
    errors,
    snapshotGate,
    mergeGate,
    staleSnapshot: { source: BEFORE, content_hash: sha(BEFORE) },
  };
}

test("a save that lands mid-merge supersedes the stale merge instead of conflicting", async () => {
  const h = setup();
  try {
    h.flow.activate(h.work);
    h.setEditor(AFTER);
    h.flow.noteChange();
    const resolved = h.flow.resolveExternalChange("work-1", h.staleSnapshot);
    await waitFor(
      () => h.snapshots.length === 1,
      "the stale echo should enter the snapshot merge path"
    );
    // The timer save lands while the merge awaits its snapshots.
    assert.equal(await h.flow.flush(), true);
    assert.equal(h.work.content_hash, sha(AFTER));
    h.snapshotGate.resolve();
    await waitFor(
      () => h.mergeCalls.length === 1,
      "the merge should run after the snapshots release"
    );
    h.mergeGate.resolve();
    assert.equal(await resolved, "superseded");
    assert.equal(h.flow.conflict, null);
    assert.deepEqual(h.conflicts, []);
    assert.equal(h.work.content_hash, sha(AFTER));
    assert.deepEqual(h.setSourceCalls, []);
    assert.equal(h.disk.source, AFTER);
    assert.equal(h.saves.length, 1);
  } finally {
    h.flow.deactivate();
  }
});

test("an uninterrupted dirty merge still applies and saves", async () => {
  const h = setup();
  try {
    h.flow.activate(h.work);
    h.setEditor(AFTER);
    h.flow.noteChange();
    const resolved = h.flow.resolveExternalChange("work-1", h.staleSnapshot);
    await waitFor(
      () => h.snapshots.length === 1,
      "the echo should enter the snapshot merge path"
    );
    h.snapshotGate.resolve();
    await waitFor(
      () => h.mergeCalls.length === 1,
      "the merge should run after the snapshots release"
    );
    h.mergeGate.resolve();
    assert.equal(await resolved, "merged");
    assert.equal(h.flow.conflict, null);
    assert.equal(h.disk.source, AFTER);
    assert.equal(h.work.content_hash, sha(AFTER));
    assert.deepEqual(h.setSourceCalls, [AFTER]);
  } finally {
    h.flow.deactivate();
  }
});
