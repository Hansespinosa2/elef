import { test } from "node:test";
import assert from "node:assert/strict";
import { CASES, SUITE_VERSION, runSuite } from "./suite.js";
import { createFakeHost, fakePolicy } from "./adapters/fake-host.js";

const shim = {
  equal: (actual, expected, message) => assert.equal(actual, expected, message),
  ok: (value, message) => assert.ok(value, message),
};

const prefix = `node-fake-${Date.now().toString(36)}`;
const results = await runSuite(createFakeHost(), fakePolicy, prefix, shim);

for (const result of results) {
  await test(`fake: ${result.id}`, () => {
    assert.equal(result.outcome !== "fail", true, `${result.id}: ${result.reason}`);
  });
}

const failed = results.filter((result) => result.outcome === "fail");
const skipped = results.filter((result) => result.outcome === "skip");
console.log(
  `conformance fake: ${results.length - failed.length - skipped.length} passed, ` +
    `${skipped.length} skipped, ${failed.length} failed ` +
    `(suite v${SUITE_VERSION}, ${CASES.length} cases)`,
);
if (failed.length > 0) process.exitCode = 1;
