// Scroll preservation across paginated-surface rebuilds: replacing the
// surface children collapses its scroll height, clamping every scroller
// to the top. Capture the scroll chain plus a content anchor before the
// rebuild and restore it after, so repagination is viewport-transparent.
//
// The anchor (first visible block id) gates the restore: when the anchor
// block is gone after the rebuild — a different work opened, first load —
// the surface keeps its natural top instead of inheriting stale offsets.
// A deleted visible block lands at the top too (status quo for that rare
// case); same-document edits, the common path, restore exactly.
export interface PreservedSurfaceScroll {
  restore(surface?: Element): void;
}

interface ScrollerEntry {
  node: Element;
  top: number;
  left: number;
}

function isScrollable(element: Element): boolean {
  return element.scrollHeight > element.clientHeight + 1 || element.scrollWidth > element.clientWidth + 1;
}

export function preserveSurfaceScroll(surface: Element): PreservedSurfaceScroll {
  const chain: ScrollerEntry[] = [];
  let ancestor: Element | null = surface;
  while (ancestor) {
    if (isScrollable(ancestor)) chain.push({ node: ancestor, top: ancestor.scrollTop, left: ancestor.scrollLeft });
    ancestor = ancestor.parentElement;
  }
  const scroller = chain.length > 0 ? chain.at(0)?.node ?? null : null;
  const viewportTop = scroller ? scroller.getBoundingClientRect().top : 0;
  const blocks = [...surface.querySelectorAll("[data-editor-block-id]")];
  const anchor = blocks.find(block => block.getBoundingClientRect().bottom > viewportTop + 1) ?? null;
  const anchorBlockId = anchor?.getAttribute("data-editor-block-id") ?? null;
  const hasWindow = typeof window !== "undefined" && typeof window.scrollTo === "function";
  const windowTop = hasWindow ? window.scrollY : 0;
  const windowLeft = hasWindow ? window.scrollX : 0;
  return {
    restore(currentSurface = surface) {
      // Compare by attribute instead of interpolating into a selector so
      // an unexpected id can never throw mid-paginate (after the wipe but
      // before the finalize bookkeeping below).
      if (anchorBlockId !== null) {
        let present = false;
        const blocks = currentSurface.querySelectorAll("[data-editor-block-id]");
        for (const block of blocks) {
          if (block.getAttribute("data-editor-block-id") === anchorBlockId) {
            present = true;
            break;
          }
        }
        if (!present) return;
      }
      for (const entry of chain) {
        const node = entry.node === surface ? currentSurface : entry.node;
        node.scrollLeft = entry.left;
        node.scrollTop = entry.top;
      }
      if (hasWindow && (window.scrollY !== windowTop || window.scrollX !== windowLeft)) {
        window.scrollTo(windowLeft, windowTop);
      }
    },
  };
}
