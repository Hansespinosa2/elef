// Client-owned document-graph interaction controller. Ported from the
// Stimulus-era document_graph_controller.js without behavior change:
// force simulation, pan/zoom, highlight, in-graph search, node centering.
// Framework-free: constructed with a root already rendered by renderGraphView
// (or equivalent markup), wires its own listeners, removes them on destroy.
// The animation frame scheduler is injectable so unit tests can drive the
// simulation manually; browsers use requestAnimationFrame.

import {
  clampZoom,
  edgeGeometry,
  initNodeStates,
  searchMatches,
  stepSimulation,
  wrapLabel,
  type GraphLayoutData,
  type GraphNodeState,
} from "./graphLayout.js";

export interface GraphControllerOptions {
  onOpenDeck?: (deckId: string) => void;
  scheduleFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function defaultScheduleFrame(callback: () => void): number {
  const raf = (globalThis as { requestAnimationFrame?: (cb: () => void) => number }).requestAnimationFrame;
  if (typeof raf === "function") return raf(callback);
  return 0;
}

export class GraphController {
  private root: Element;
  private data: GraphLayoutData;
  private states: Map<string, GraphNodeState>;
  private zoom = 1;
  private pan = { x: 0, y: 0 };
  private drag: { x: number; y: number; panX: number; panY: number } | null = null;
  private alpha = 0.9;
  private frame = 0;
  private disposers: Array<() => void> = [];
  private onOpenDeck: ((deckId: string) => void) | undefined;
  private scheduleFrame: (callback: () => void) => number;
  private cancelFrame: (handle: number) => void;

  constructor(root: Element, data: GraphLayoutData, options: GraphControllerOptions = {}) {
    this.root = root;
    this.data = data;
    this.states = initNodeStates(data);
    this.onOpenDeck = options.onOpenDeck;
    this.scheduleFrame = options.scheduleFrame ?? defaultScheduleFrame;
    this.cancelFrame = options.cancelFrame ?? ((handle) => {
      const caf = (globalThis as { cancelAnimationFrame?: (h: number) => void }).cancelAnimationFrame;
      if (typeof caf === "function") caf(handle);
    });
    this.mount();
  }

  destroy(): void {
    this.disposers.splice(0).forEach((dispose) => dispose());
    if (this.frame) {
      this.cancelFrame(this.frame);
      this.frame = 0;
    }
    this.drag = null;
  }

  zoomIn(): void {
    this.setZoom(this.zoom * 1.2);
  }

  zoomOut(): void {
    this.setZoom(this.zoom / 1.2);
  }

  reset(): void {
    this.zoom = 1;
    this.pan = { x: 0, y: 0 };
    this.render();
  }

  search(query: string): number {
    const results = this.resultsElement();
    const status = this.statusElement();
    const matches = searchMatches(this.data.nodes, query);
    if (results) {
      results.replaceChildren();
      if (!query.trim()) {
        this.closeSearch();
        return 0;
      }
      const document = this.root.ownerDocument;
      matches.forEach((node) => {
        const result = document.createElement("button");
        result.type = "button";
        result.textContent = String(node.title ?? "");
        result.addEventListener("click", () => {
          const input = this.searchInput();
          if (input) input.value = String(node.title ?? "");
          this.centerNode(node.id);
          this.closeSearch();
        });
        results.append(result);
      });
      results.hidden = matches.length === 0;
    }
    if (status) status.textContent = query.trim() ? `${matches.length} matching documents` : "";
    this.nodeElements().forEach((node) => {
      node.classList.toggle("is-search-match", matches.some((match) => String(match.id) === node.dataset.nodeId));
    });
    return matches.length;
  }

  closeSearch(): void {
    const results = this.resultsElement();
    if (results) results.hidden = true;
    const status = this.statusElement();
    if (status) status.textContent = "";
    this.nodeElements().forEach((node) => node.classList.remove("is-search-match"));
  }

  centerNode(id: string | number): void {
    const state = this.states.get(String(id));
    if (!state) return;
    this.pan = { x: 500 - state.x * this.zoom, y: 310 - state.y * this.zoom };
    const target = this.nodeElements().find((node) => node.dataset.nodeId === String(id)) as
      | (Element & { focus?: () => void })
      | undefined;
    target?.focus?.();
    this.render();
  }

  highlight(id?: string | number | null): void {
    const related = new Set<string>();
    if (id !== undefined && id !== null) {
      this.data.edges.forEach((edge) => {
        if (String(edge.source) === String(id)) related.add(String(edge.target));
        if (String(edge.target) === String(id)) related.add(String(edge.source));
      });
    }
    const active = id !== undefined && id !== null;
    this.nodeElements().forEach((node) => {
      const on = active && (node.dataset.nodeId === String(id) || related.has(node.dataset.nodeId ?? ""));
      node.classList.toggle("is-highlighted", Boolean(on));
      node.classList.toggle("is-dimmed", Boolean(active && !on));
    });
    this.edgeElements().forEach((edge) => {
      const on = active && (edge.dataset.sourceId === String(id) || edge.dataset.targetId === String(id));
      edge.classList.toggle("is-highlighted", Boolean(on));
      edge.classList.toggle("is-dimmed", Boolean(active && !on));
    });
  }

  step(): void {
    if (this.alpha > 0.015) {
      stepSimulation(this.states, this.data.edges);
      this.alpha *= 0.96;
      this.render();
    }
  }

  private setZoom(value: number): void {
    this.zoom = clampZoom(value);
    this.render();
  }

  private mount(): void {
    const canvas = this.canvasElement();
    if (canvas) {
      const pointerDown = (event: Event): void => this.startPan(event as PointerEvent);
      const pointerMove = (event: Event): void => this.movePan(event as PointerEvent);
      const pointerUp = (): void => this.stopPan();
      const wheel = (event: Event): void => this.onWheel(event as WheelEvent);
      canvas.addEventListener("pointerdown", pointerDown);
      canvas.addEventListener("pointermove", pointerMove);
      canvas.addEventListener("pointerup", pointerUp);
      canvas.addEventListener("pointercancel", pointerUp);
      canvas.addEventListener("wheel", wheel, { passive: false });
      this.disposers.push(() => {
        canvas.removeEventListener("pointerdown", pointerDown);
        canvas.removeEventListener("pointermove", pointerMove);
        canvas.removeEventListener("pointerup", pointerUp);
        canvas.removeEventListener("pointercancel", pointerUp);
        canvas.removeEventListener("wheel", wheel);
      });
    }
    const eventTarget = this.eventTarget();
    if (eventTarget) {
      const onResize = (): void => this.render();
      eventTarget.addEventListener("resize", onResize);
      this.disposers.push(() => eventTarget.removeEventListener("resize", onResize));
    }

    this.nodeElements().forEach((node) => {
      const id = node.dataset.nodeId ?? "";
      const enter = (): void => this.highlight(id);
      const leave = (): void => this.highlight();
      node.addEventListener("mouseenter", enter);
      node.addEventListener("focus", enter);
      node.addEventListener("mouseleave", leave);
      node.addEventListener("blur", leave);
      this.disposers.push(() => {
        node.removeEventListener("mouseenter", enter);
        node.removeEventListener("focus", enter);
        node.removeEventListener("mouseleave", leave);
        node.removeEventListener("blur", leave);
      });
      const click = (event: Event): void => {
        if (!this.onOpenDeck) return;
        event.preventDefault();
        this.onOpenDeck(id);
      };
      node.addEventListener("click", click);
      this.disposers.push(() => node.removeEventListener("click", click));
    });

    const zoomOutButton = this.controlButton("Zoom out");
    const zoomInButton = this.controlButton("Zoom in");
    const resetButton = this.controlButton("Reset graph view");
    const zoomOut = (): void => this.zoomOut();
    const zoomIn = (): void => this.zoomIn();
    const reset = (): void => this.reset();
    zoomOutButton?.addEventListener("click", zoomOut);
    zoomInButton?.addEventListener("click", zoomIn);
    resetButton?.addEventListener("click", reset);
    this.disposers.push(() => {
      zoomOutButton?.removeEventListener("click", zoomOut);
      zoomInButton?.removeEventListener("click", zoomIn);
      resetButton?.removeEventListener("click", reset);
    });
    const input = this.searchInput();
    if (input) {
      const onInput = (): void => {
        this.search(input.value);
      };
      const onKey = (event: KeyboardEvent): void => {
        if (event.key !== "ArrowDown") return;
        (this.resultsElement()?.querySelector("button") as (HTMLButtonElement & { focus?: () => void }) | null)?.focus?.();
      };
      input.addEventListener("input", onInput);
      input.addEventListener("keydown", onKey as EventListener);
      this.disposers.push(() => {
        input.removeEventListener("input", onInput);
        input.removeEventListener("keydown", onKey as EventListener);
      });
    }

    const status = this.statusElement();
    if (status) status.textContent = `${this.data.nodes.length}${this.data.nodes.length === 1 ? " document" : " documents"}`;
    this.frame = this.scheduleFrame(() => this.tick());
    this.render();
  }

  private tick = (): void => {
    if (this.alpha > 0.015) {
      this.step();
      this.frame = this.scheduleFrame(() => this.tick());
    }
  };

  private render(): void {
    const canvas = this.canvasElement();
    const canvasScale = Math.max(((canvas?.clientWidth as number | undefined) ?? 0) / 1000, 0.01);
    const labelSize = Math.max(15, 12 / canvasScale);
    this.nodeElements().forEach((node) => {
      const state = this.states.get(String(node.dataset.nodeId));
      if (state) {
        node.setAttribute("transform", `translate(${state.x} ${state.y})`);
        this.renderLabel(node, state, labelSize);
      }
    });
    this.edgeElements().forEach((edge) => {
      const source = this.states.get(String(edge.dataset.sourceId));
      const target = this.states.get(String(edge.dataset.targetId));
      if (!source || !target) return;
      const geometry = edgeGeometry(source, target);
      edge.setAttribute("x1", String(geometry.x1));
      edge.setAttribute("y1", String(geometry.y1));
      edge.setAttribute("x2", String(geometry.x2));
      edge.setAttribute("y2", String(geometry.y2));
    });
    this.viewportElement()?.setAttribute("transform", `translate(${this.pan.x} ${this.pan.y}) scale(${this.zoom})`);
    const scaleLabel = this.controlButton("Reset graph view");
    if (scaleLabel) scaleLabel.textContent = `${Math.round(this.zoom * 100)}%`;
  }

  private renderLabel(node: HTMLElement, state: GraphNodeState, labelSize: number): void {
    const label = node.querySelector("text");
    if (!label) return;
    const title = node.dataset.title || label.textContent || "";
    const maxWidth = 250;
    const maxCharacters = Math.max(10, Math.floor(maxWidth / (labelSize * 0.65)));
    const lines = wrapLabel(title, maxCharacters);
    const lineHeight = labelSize * 1.15;
    const placeRight = state.x + 22 + maxWidth <= 980;
    const x = placeRight ? 22 : -22;
    const startY = state.y + lineHeight * lines.length > 600 ? -lineHeight * (lines.length - 1) + 5 : 5;
    const layout = JSON.stringify({ title, labelSize, x, startY });
    if (node.dataset.labelLayout === layout) return;
    label.replaceChildren();
    label.setAttribute("x", String(x));
    label.setAttribute("y", String(startY));
    label.setAttribute("text-anchor", placeRight ? "start" : "end");
    (label as unknown as { style?: { setProperty?: (k: string, v: string) => void } }).style?.setProperty?.(
      "font-size",
      `${labelSize}px`,
    );
    const document = this.root.ownerDocument;
    lines.forEach((line, index) => {
      const tspan = document.createElementNS(SVG_NAMESPACE, "tspan");
      tspan.textContent = line;
      tspan.setAttribute("x", String(x));
      if (index > 0) tspan.setAttribute("dy", String(lineHeight));
      label.append(tspan);
    });
    const getBBox = (label as unknown as { getBBox?: () => { x: number; y: number; width: number; height: number } }).getBBox;
    const hitArea = node.querySelector(".document-graph-node-hit-area");
    const circle = node.querySelector("circle");
    if (typeof getBBox === "function" && hitArea && circle) {
      const labelBounds = getBBox.call(label);
      const circleGetBBox = (circle as unknown as { getBBox?: () => { x: number; y: number; width: number; height: number } }).getBBox;
      if (typeof circleGetBBox !== "function") return;
      const circleBounds = circleGetBBox.call(circle);
      const padding = 4;
      const left = Math.min(labelBounds.x, circleBounds.x) - padding;
      const top = Math.min(labelBounds.y, circleBounds.y) - padding;
      const right = Math.max(labelBounds.x + labelBounds.width, circleBounds.x + circleBounds.width) + padding;
      const bottom = Math.max(labelBounds.y + labelBounds.height, circleBounds.y + circleBounds.height) + padding;
      hitArea.setAttribute("x", String(left));
      hitArea.setAttribute("y", String(top));
      hitArea.setAttribute("width", String(right - left));
      hitArea.setAttribute("height", String(bottom - top));
    }
    node.dataset.labelLayout = layout;
  }

  private startPan(event: PointerEvent): void {
    if ((event.target as Element | null)?.closest?.(".document-graph-node")) return;
    this.drag = { x: event.clientX, y: event.clientY, panX: this.pan.x, panY: this.pan.y };
    (event.target as Element | null)?.setPointerCapture?.(event.pointerId);
  }

  private movePan(event: PointerEvent): void {
    if (!this.drag) return;
    this.pan.x = this.drag.panX + event.clientX - this.drag.x;
    this.pan.y = this.drag.panY + event.clientY - this.drag.y;
    this.render();
  }

  private stopPan(): void {
    this.drag = null;
  }

  private onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.setZoom(this.zoom * (event.deltaY < 0 ? 1.08 : 0.92));
  }

  private eventTarget(): {
    addEventListener: (type: string, listener: () => void) => void;
    removeEventListener: (type: string, listener: () => void) => void;
  } | null {
    const view = this.root.ownerDocument?.defaultView as unknown;
    const candidate = (view ?? globalThis) as {
      addEventListener?: (type: string, listener: () => void) => void;
      removeEventListener?: (type: string, listener: () => void) => void;
    };
    if (typeof candidate.addEventListener !== "function" || typeof candidate.removeEventListener !== "function") {
      return null;
    }
    return candidate as {
      addEventListener: (type: string, listener: () => void) => void;
      removeEventListener: (type: string, listener: () => void) => void;
    };
  }

  private canvasElement(): HTMLElement | null {
    return this.root.querySelector(".document-graph-canvas");
  }

  private viewportElement(): Element | null {
    return this.root.querySelector("[data-graph-viewport]");
  }

  private nodeElements(): HTMLElement[] {
    return [...this.root.querySelectorAll(".document-graph-node")] as HTMLElement[];
  }

  private edgeElements(): HTMLElement[] {
    return [...this.root.querySelectorAll(".document-graph-edge")] as HTMLElement[];
  }

  private searchInput(): HTMLInputElement | null {
    return this.root.querySelector("#document-graph-search");
  }

  private resultsElement(): HTMLElement | null {
    return this.root.querySelector(".document-graph-results");
  }

  private statusElement(): HTMLElement | null {
    return this.root.querySelector("[aria-live]");
  }

  private controlButton(label: string): HTMLButtonElement | null {
    return this.root.querySelector(`.document-graph-controls button[aria-label="${label}"]`);
  }
}
