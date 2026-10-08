import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { ElefHost } from "@elef/contracts";
import type { ElefMountOptions, ElefShell, LibraryFilter, NoticeTone } from "./types.js";
import { parseLibraryRoute } from "./router.js";
import type { LibraryControl } from "../features/library/LibraryApp.js";
import { LibraryApp } from "../features/library/LibraryApp.js";

export async function mountElef(
  hostElement: HTMLElement,
  host: ElefHost,
  options: ElefMountOptions = {},
): Promise<ElefShell> {
  const document = hostElement.ownerDocument;
  const container = document.createElement("div");
  container.setAttribute("data-elef-shell", "true");
  hostElement.appendChild(container);
  const root: Root = createRoot(container);
  const route =
    options.initialUrl === undefined ? null : parseLibraryRoute(options.initialUrl);

  let control: LibraryControl | null = null;
  function render(): void {
    // Synchronous commit: slot adoption below and host paint measurements
    // need the committed DOM, not a scheduled render.
    flushSync(() => {
      root.render(
        createElement(LibraryApp, {
          host,
          initialFilter: route?.filter ?? "all",
          options,
          registerControl: (next) => {
            control = next;
          },
        }),
      );
    });
  }

  render();
  adoptHostSlots(hostElement, container, route?.filter ?? "all");
  return {
    // Data reload preserving UI state (filter, search, adopted slots):
    // matches the desktop refreshLibrary semantics the E2E probe measures.
    async refresh(): Promise<void> {
      if (control !== null) await control.reload();
    },
    // Synchronous commits: hosts call these from their own event flows
    // (view switches, error surfaces) and read the DOM right after.
    notify(message: string | null, tone: NoticeTone = "info"): void {
      if (control === null) return;
      const active = control;
      flushSync(() => active.notify(message, tone));
    },
    setFilter(filter: LibraryFilter): void {
      if (control === null) return;
      const active = control;
      flushSync(() => active.setFilter(filter));
    },
    unmount(): void {
      root.unmount();
      container.remove();
    },
  };
}

// Moves server-rendered host templates (graph/lineage panels, library
// actions) from the mount element into the rendered slot targets. Runs once
// per mount, before paint-visible interaction; host Stimulus controllers
// reconnect through the host MutationObserver.
function adoptHostSlots(hostElement: HTMLElement, container: HTMLElement, filter: LibraryFilter): void {
  const templates = hostElement.querySelectorAll("template[data-client-slot]");
  for (const node of templates) {
    const template = node as unknown as HTMLTemplateElement;
    const name = template.getAttribute("data-client-slot");
    const target = name === null ? null : container.querySelector(`[data-client-slot-target="${name}"]`);
    if (target === null) continue;
    target.replaceChildren(template.content);
    template.remove();
  }
  const graph = container.querySelector("#document-graph-view");
  if (graph !== null && graph.childElementCount > 0) {
    (graph as unknown as { hidden: boolean }).hidden = filter !== "documents";
  }
}
