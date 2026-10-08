import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { renderPreviewCore } from "@elef/renderer";
import { editorChrome } from "../../../app/javascript/lib/preview_chrome.js";
import { installSanitizedPreview } from "../../../app/javascript/lib/preview_sanitizer.js";
import { CASES, runChecks } from "../../../test/javascript/shared/preview_sanitizer_cases.js";
import { sanitizePreview } from "../src/ui/sanitize.js";

interface InstallStep {
  readonly html?: string;
  readonly render?: { readonly source: string; readonly kind?: string };
  readonly options: {
    readonly interactive?: boolean;
    readonly documentPagination?: boolean;
    readonly mediaBaseUrl?: string;
  };
}

interface SanitizerCase {
  readonly name: string;
  readonly installs: readonly InstallStep[];
  readonly checks: readonly unknown[];
}

function renderPreview(input: { source: string; kind?: string }): string {
  return (
    renderPreviewCore({ source: input.source, kind: input.kind ?? "presentation" }, { chrome: editorChrome }) as unknown as {
      html: string;
    }
  ).html;
}

function freshContainer(): Element {
  const { document } = parseHTML("<main id='preview'></main>");
  return document.querySelector("#preview") as unknown as Element;
}

for (const kase of CASES as readonly SanitizerCase[]) {
  test(`sanitizer parity: ${kase.name}`, () => {
    const legacy = freshContainer();
    const ported = freshContainer();
    for (const install of kase.installs) {
      const html = install.render !== undefined ? renderPreview(install.render) : (install.html as string);
      installSanitizedPreview(legacy, html, install.options);
      sanitizePreview(ported, html, install.options);
    }
    assert.equal(
      ported.innerHTML,
      legacy.innerHTML,
      "port output is byte-identical to the lib implementation",
    );
    runChecks(
      ported,
      kase.checks as Parameters<typeof runChecks>[1],
      assert as unknown as Parameters<typeof runChecks>[2],
    );
  });
}
