import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import type { WorkKind } from "@elef/contracts";
import { NewWorkMenu } from "../features/library/NewWorkMenu.js";

export interface NewWorkMenuHandle {
  setDisabled(disabled: boolean): void;
  unmount(): void;
}

// Host mount for the shared New dropdown outside the library view (the
// desktop header keeps the menu where the old button sat). React stays
// inside this package: hosts pass a plain callback and get a plain handle.
export function mountNewWorkMenu(
  hostElement: HTMLElement,
  hooks: { onSelect: (kind: WorkKind) => void; disabled?: boolean },
): NewWorkMenuHandle {
  const container = hostElement.ownerDocument.createElement("div");
  container.setAttribute("data-elef-new-work-menu", "true");
  hostElement.replaceChildren(container);
  const root: Root = createRoot(container);
  function render(disabled: boolean): void {
    flushSync(() => {
      root.render(createElement(NewWorkMenu, { onSelect: hooks.onSelect, disabled }));
    });
  }
  render(hooks.disabled ?? false);
  return {
    setDisabled(disabled: boolean): void {
      render(disabled);
    },
    unmount(): void {
      root.unmount();
      container.remove();
    },
  };
}
