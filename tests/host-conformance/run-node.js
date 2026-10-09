// node:test entry for the contract conformance suite.
// Usage: node tests/host-conformance/run-node.js fake
//        ELEF_CONFORMANCE_RAILS_URL=http://127.0.0.1:3100 node tests/host-conformance/run-node.js rails
import { test } from "node:test";
import assert from "node:assert/strict";
import { CASES, runSuite } from "./suite.js";
import { createFakeHost, fakePolicy } from "./adapters/fake-host.js";
import { createRailsHost, railsPolicy } from "../../app/javascript/host/rails-http-host.js";

const adapter = process.argv[2] ?? "fake";

const shim = {
  equal: (actual, expected, message) => assert.equal(actual, expected, message),
  ok: (value, message) => assert.ok(value, message),
};

let host;
let policy;
if (adapter === "fake") {
  host = createFakeHost();
  policy = fakePolicy;
} else if (adapter === "rails") {
  const baseUrl = process.env.ELEF_CONFORMANCE_RAILS_URL;
  if (!baseUrl) {
    console.log("ELEF_CONFORMANCE_RAILS_URL is not set; rails conformance cannot run here.");
    process.exit(2);
  }
  host = await createRailsHost({ baseUrl });
  policy = railsPolicy;
} else {
  console.log(`unknown adapter: ${adapter}`);
  process.exit(2);
}

const prefix = `node-${adapter}-${Date.now().toString(36)}`;
const results = await runSuite(host, policy, prefix, shim);

for (const result of results) {
  await test(`${adapter}: ${result.id}`, () => {
    assert.equal(result.outcome !== "fail", true, `${result.id}: ${result.reason}`);
  });
}

const failed = results.filter((result) => result.outcome === "fail");
const skipped = results.filter((result) => result.outcome === "skip");
console.log(
  `conformance ${adapter}: ${results.length - failed.length - skipped.length} passed, ` +
    `${skipped.length} skipped, ${failed.length} failed (suite v${CASES.length} cases)`,
);
if (failed.length > 0) process.exitCode = 1;
