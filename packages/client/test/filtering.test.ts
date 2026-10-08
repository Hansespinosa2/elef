import { test } from "node:test";
import assert from "node:assert/strict";
import type { WorkSummary } from "@elef/contracts";
import { sameWorks } from "../src/features/library/filtering.js";
import { ws } from "./helpers.js";

function work(id: string, overrides: Partial<WorkSummary> = {}): WorkSummary {
  return {
    id: id as WorkSummary["id"],
    workspaceId: ws("ws-1"),
    title: `Title ${id}`,
    kind: "document",
    ...overrides,
  };
}

test("sameWorks treats fresh-but-equal lists as identical", () => {
  const a = [work("a", { updatedAt: "2026-10-08T00:00:00.000Z", warnings: ["w"] }), work("b")];
  const b = [work("a", { updatedAt: "2026-10-08T00:00:00.000Z", warnings: ["w"] }), work("b")];
  assert.notEqual(a[0], b[0], "reloads always build new objects");
  assert.equal(sameWorks(a, b), true);
  assert.equal(sameWorks([], []), true);
});

test("sameWorks detects every displayed-field change", () => {
  const base = [work("a"), work("b")];
  assert.equal(sameWorks(base, [work("a")]), false, "length");
  assert.equal(sameWorks(base, [work("x"), work("b")]), false, "id");
  assert.equal(sameWorks(base, [work("a", { title: "Other" }), work("b")]), false, "title");
  assert.equal(sameWorks(base, [work("a", { kind: "presentation" }), work("b")]), false, "kind");
  assert.equal(sameWorks(base, [work("a", { workspaceId: ws("ws-2") }), work("b")]), false, "workspace");
  assert.equal(sameWorks(base, [work("a", { updatedAt: "2026-10-08T00:00:01.000Z" }), work("b")]), false, "updatedAt");
  assert.equal(sameWorks(base, [work("a", { warnings: ["new"] }), work("b")]), false, "warnings");
  assert.equal(sameWorks(base, [work("b"), work("a")]), false, "order");
});

test("sameWorks normalizes missing optional fields", () => {
  // Untyped JS adapters can pass explicit undefined at runtime even though
  // exactOptionalPropertyTypes forbids writing it in a typed literal.
  const explicitUndefined = { updatedAt: undefined, warnings: undefined } as unknown as Partial<WorkSummary>;
  assert.equal(sameWorks([work("a")], [work("a", explicitUndefined)]), true);
  assert.equal(sameWorks([work("a", { warnings: [] })], [work("a")]), true);
});
