import { act } from "react";
import { parseHTML } from "linkedom";

// React reads the testing flag from the global scope, not the environment.
(globalThis as Record<string, unknown>)["IS_REACT_ACT_ENVIRONMENT"] = true;
import { createFakeHost } from "../../../tests/host-conformance/adapters/fake-host.js";
import { mountElef } from "../src/index.js";
import type { ElefHost, ElefMountOptions } from "../src/index.js";
import type { WorkspaceId } from "@elef/contracts";

export function typedHost(): ElefHost {
  return createFakeHost() as unknown as ElefHost;
}

export function ws(id: string): WorkspaceId {
  return id as WorkspaceId;
}

export async function settled(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
}

export async function mountInto(host: ElefHost, options: ElefMountOptions = {}) {
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

export async function click(target: unknown): Promise<void> {
  await act(async () => {
    (target as { click: () => void }).click();
  });
  await settled();
}

export async function submitForm(form: unknown): Promise<void> {
  const node = form as {
    ownerDocument: Document;
    dispatchEvent: (event: unknown) => void;
  };
  const event = node.ownerDocument.createEvent("Event");
  event.initEvent("submit", true, true);
  await act(async () => {
    node.dispatchEvent(event);
  });
  await settled();
}

export async function setInputValue(input: unknown, value: string): Promise<void> {
  const node = input as {
    ownerDocument: Document;
    value: string;
    dispatchEvent: (event: unknown) => void;
  };
  node.value = value;
  const event = node.ownerDocument.createEvent("Event");
  event.initEvent("input", true, false);
  await act(async () => {
    node.dispatchEvent(event);
  });
  await settled();
}

export const setSearchInput = setInputValue;
