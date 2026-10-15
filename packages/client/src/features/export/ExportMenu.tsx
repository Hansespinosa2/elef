// Shared work Export menu (P07-06): one component renders the Export and
// Save-to-PDF actions identically on every host. Option visibility comes
// from the export registry (which formats exist per Work kind); delivery
// (where the bytes or dialogs come from) rides host-supplied seams, so the
// client never branches on hosts. Hosts mount it through mountExportMenu
// and keep only their delivery functions.

import { createElement, useEffect, useRef } from "react";
import type { JSX, MouseEvent } from "react";
import { createRoot } from "react-dom/client";
import type { WorkKind } from "@elef/contracts";
import { exportFormatsFor } from "./registry.js";

export type ExportEdition = "draft" | "published";

export type ExportDelivery = () => void | Promise<void>;

export interface ExportMenuEditionSeams {
  readonly edition: ExportEdition;
  // Web navigates to its print route; desktop runs its native print seam.
  // Absent when printing is unavailable (e.g. a web new-record page).
  readonly printHref?: string | null;
  readonly onPrint?: ExportDelivery | null;
  // Absent when PPTX is unavailable. Documents never offer PPTX: the
  // registry scopes that format to presentations.
  readonly onExportPptx?: ExportDelivery | null;
  // Stable hook ids so host suites keep addressing the same nodes.
  readonly printOptionId: string;
  readonly pptxOptionId: string;
}

export type ExportMenuFormat = "print" | "pptx";

export interface ExportMenuOption {
  readonly id: string;
  readonly format: ExportMenuFormat;
  readonly edition: ExportEdition;
  readonly label: string;
  readonly href?: string | null;
  readonly run?: ExportDelivery | null;
}

function optionLabel(format: ExportMenuFormat, edition: ExportEdition, editionCount: number): string {
  if (format === "pptx") {
    if (edition === "published") return "Download published PPTX";
    return editionCount > 1 ? "Download PPTX draft" : "Download PPTX";
  }
  if (edition === "published") return "Print published release";
  return editionCount > 1 ? "Print draft / save PDF" : "Print / Save PDF";
}

// Builds the visible menu options for one Work: labels are shared truth,
// delivery rides the per-edition seams. Print and PDF collapse into the one
// print-pipeline option both hosts serve; PPTX appears only where the
// registry offers it for the kind.
export function exportMenuOptionsFor({
  kind,
  editions,
}: {
  kind: WorkKind;
  editions: ReadonlyArray<ExportMenuEditionSeams>;
}): Array<ExportMenuOption> {
  const formats = exportFormatsFor({ kind });
  const offersPrint = formats.some((format) => format.engine === "print");
  const offersPptx = formats.some((format) => format.id === "pptx");
  const options: Array<ExportMenuOption> = [];
  for (const edition of editions) {
    if (offersPrint && (edition.printHref || edition.onPrint)) {
      options.push({
        id: edition.printOptionId,
        format: "print",
        edition: edition.edition,
        label: optionLabel("print", edition.edition, editions.length),
        href: edition.printHref ?? null,
        run: edition.onPrint ?? null,
      });
    }
    if (offersPptx && edition.onExportPptx) {
      options.push({
        id: edition.pptxOptionId,
        format: "pptx",
        edition: edition.edition,
        label: optionLabel("pptx", edition.edition, editions.length),
        href: null,
        run: edition.onExportPptx,
      });
    }
  }
  return options;
}

export interface ExportMenuProps {
  readonly menuId: string;
  readonly buttonId: string;
  readonly menuLabel: string;
  readonly statusId: string;
  readonly options: ReadonlyArray<ExportMenuOption>;
}

function closeMenu(menu: HTMLDetailsElement | null): void {
  if (menu) menu.open = false;
}

export function ExportMenu({ menuId, buttonId, menuLabel, statusId, options }: ExportMenuProps): JSX.Element | null {
  const menuRef = useRef<HTMLDetailsElement | null>(null);
  // The menu closes on activation, outside interaction, and Escape — the
  // same dismissal contract on every host.
  useEffect(() => {
    function dismissOnOutsideEvent(event: Event): void {
      const target = event.target as { closest?: (selector: string) => unknown } | null;
      if (typeof target?.closest !== "function" || !target.closest(`#${menuId}`)) closeMenu(menuRef.current);
    }
    function dismissOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") closeMenu(menuRef.current);
    }
    document.addEventListener("pointerdown", dismissOnOutsideEvent);
    document.addEventListener("click", dismissOnOutsideEvent);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOnOutsideEvent);
      document.removeEventListener("click", dismissOnOutsideEvent);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [menuId]);
  if (options.length === 0) return null;
  function activate(option: ExportMenuOption, event: MouseEvent): void {
    // Anchors navigate on their own; callbacks run after the menu closes.
    if (!option.href) event.preventDefault();
    closeMenu(menuRef.current);
    void option.run?.();
  }
  return (
    <>
      <details id={menuId} className="export-menu relative" ref={menuRef}>
        <summary
          id={buttonId}
          className="button secondary inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-4 py-2 font-bold"
        >
          {menuLabel} <span aria-hidden="true">▾</span>
        </summary>
        <div
          className="export-menu-panel absolute top-full z-10 mt-2 w-56 max-w-[calc(100vw-2rem)] rounded-lg border p-1"
          role="menu"
          aria-label="Export options"
        >
          {options.map((option) =>
            option.href ? (
              <a
                key={option.id}
                id={option.id}
                className="export-menu-option block w-full rounded-lg px-3 py-2 text-left text-sm font-bold"
                role="menuitem"
                href={option.href}
                data-export-format={option.format}
                data-export-edition={option.edition}
                onClick={(event) => activate(option, event)}
              >
                {option.label}
              </a>
            ) : (
              <button
                key={option.id}
                id={option.id}
                className="export-menu-option block w-full rounded-lg px-3 py-2 text-left text-sm font-bold"
                role="menuitem"
                type="button"
                data-export-format={option.format}
                data-export-edition={option.edition}
                onClick={(event) => activate(option, event)}
              >
                {option.label}
              </button>
            ),
          )}
        </div>
      </details>
      <span id={statusId} className="ml-2 text-sm" role="status" aria-live="polite"></span>
    </>
  );
}

export interface ExportMenuHandle {
  update(next: ExportMenuProps): void;
  unmount(): void;
}

// Host entry for embedding the shared Export menu: hosts never touch React
// directly — the dist bundle owns it. Props (kind-derived options, delivery
// seams) refresh through update() as the open Work changes.
export function mountExportMenu(container: Element, initial: ExportMenuProps): ExportMenuHandle {
  let current = initial;
  const root = createRoot(container);
  root.render(createElement(ExportMenu, current));
  return {
    update(next: ExportMenuProps): void {
      current = next;
      root.render(createElement(ExportMenu, current));
    },
    unmount(): void {
      root.unmount();
    },
  };
}
