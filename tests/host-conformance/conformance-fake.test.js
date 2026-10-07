import { test } from "node:test";
import assert from "node:assert/strict";
import { runSuite } from "./suite.js";
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
if (failed.length > 0) process.exitCode = 1;
