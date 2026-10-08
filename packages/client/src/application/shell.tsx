import { createElement } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { ElefHost } from "@elef/contracts";
import type { ElefMountOptions, ElefShell } from "./types.js";
import { parseLibraryRoute } from "./router.js";
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

  function render(): void {
    root.render(
      createElement(LibraryApp, {
        host,
        initialFilter: route?.filter ?? "all",
        options,
      }),
    );
  }

  render();
  return {
    async refresh(): Promise<void> {
      render();
    },
    unmount(): void {
      root.unmount();
      container.remove();
    },
  };
}
