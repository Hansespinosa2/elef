import { useEffect, useId, useRef, useState } from "react";
import type { JSX, KeyboardEvent, MouseEvent } from "react";
import type { WorkKind } from "@elef/contracts";

// Shared New dropdown: the same component both hosts mount, styled by the
// web classes (`new-work-*` in base.css) so it is visually identical
// everywhere. Hosts only supply `onSelect`: creation itself stays in the
// host adapter, matching the old create-then-open sequence.
export interface NewWorkMenuProps {
  readonly onSelect: (kind: WorkKind) => void;
  readonly disabled?: boolean;
  readonly className?: string;
}

const OPTIONS: readonly { kind: WorkKind; title: string; copy: string; icon: JSX.Element }[] = [
  {
    kind: "document",
    title: "Document",
    copy: "Continuous Markdown for writing",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <path d="M6.5 3.75h7.25L18.5 8.5v11.75a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1v-15.5a1 1 0 0 1 1-1Z" />
        <path d="M13.5 3.75V9h5M8.5 13h7M8.5 16.5h5" />
      </svg>
    ),
  },
  {
    kind: "presentation",
    title: "Presentation",
    copy: "Slide-based Markdown for talks",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <rect x="4" y="5" width="16" height="14" rx="1.5" />
        <path d="M7.5 9h9M7.5 12.5h6M7.5 16h3" />
      </svg>
    ),
  },
];

export function NewWorkMenu({ onSelect, disabled = false, className = "" }: NewWorkMenuProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    optionRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: globalThis.MouseEvent): void {
      if (rootRef.current !== null && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    // Outside pointerdown dismisses immediately for mouse and touch; keyboard
    // activation never fires pointerdown, so inside keyboard use is safe.
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open ]);

  function choose(kind: WorkKind): void {
    setOpen(false);
    triggerRef.current?.focus();
    onSelect(kind);
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setActive(0);
      setOpen(true);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive(OPTIONS.length - 1);
      setOpen(true);
    }
  }

  function onOptionKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number): void {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index + 1) % OPTIONS.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index - 1 + OPTIONS.length) % OPTIONS.length);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  }

  function onTriggerClick(event: MouseEvent<HTMLButtonElement>): void {
    event.preventDefault();
    if (!disabled) {
      setActive(0);
      setOpen((value) => !value);
    }
  }

  return (
    <div
      ref={rootRef}
      className={`new-work-menu relative${className === "" ? "" : ` ${className}`}`}
      data-open={open}
    >
      <button
        ref={triggerRef}
        type="button"
        className="new-work-trigger inline-flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold text-[#aab7b1] list-none"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={panelId}
        disabled={disabled}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
      >
        <span className="new-work-plus" aria-hidden="true">
          +
        </span>
        <span>New</span>
        <span className="new-work-chevron" aria-hidden="true" />
      </button>
      {open && (
        <div
          id={panelId}
          className="new-work-panel absolute right-0 top-full z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-[#304047] bg-[#182126] p-2 shadow-2xl"
          role="menu"
          aria-label="Create new"
        >
          {OPTIONS.map((option, index) => (
            <button
              key={option.kind}
              ref={(node) => {
                optionRefs.current[index] = node;
              }}
              type="button"
              className="new-work-option flex items-center gap-3 rounded-lg p-3 no-underline"
              role="menuitem"
              data-new-work-kind={option.kind}
              tabIndex={index === active ? 0 : -1}
              onClick={() => choose(option.kind)}
              onKeyDown={(event) => onOptionKeyDown(event, index)}
            >
              <span
                className={`new-work-icon new-work-icon-${option.kind} inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#304047] bg-[#202c32] text-[#9fc5a9]`}
                aria-hidden="true"
              >
                {option.icon}
              </span>
              <span className="new-work-copy">
                <strong>{option.title}</strong>
                <small>{option.copy}</small>
              </span>
              <span className="new-work-arrow" aria-hidden="true">
                →
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
