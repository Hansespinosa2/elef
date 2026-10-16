import { StateEffect, StateField } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
const snippetStopsEffect = StateEffect.define();
class EmptyStopWidget extends WidgetType {
  active;
  constructor(active) {
    super();
    this.active = active;
  }
  eq(other) {
    return other.active === this.active;
  }
  toDOM() {
    const marker = document.createElement("span");
    marker.className = this.active ? "cm-snippet-stop cm-snippet-stop-empty cm-snippet-stop-active" : "cm-snippet-stop cm-snippet-stop-empty";
    marker.setAttribute("aria-hidden", "true");
    return marker;
  }
  ignoreEvent() {
    return false;
  }
}
const stopMark = (active) => Decoration.mark({ class: active ? "cm-snippet-stop cm-snippet-stop-active" : "cm-snippet-stop" });
function buildDecorations(state, stops) {
  const length = state.doc.length;
  const ranges = [];
  stops.forEach((stop) => {
    const from = Math.max(0, Math.min(stop.from, length));
    const to = Math.max(from, Math.min(stop.to, length));
    if (from < to) ranges.push({ from, to, active: Boolean(stop.active) });
    else ranges.push({ from, to: from, active: Boolean(stop.active), empty: true });
  });
  ranges.sort((left, right) => left.from - right.from || left.to - right.to);
  const decorations = [];
  let previousTo = 0;
  ranges.forEach((range) => {
    if (range.from < previousTo) return;
    previousTo = Math.max(previousTo, range.to);
    if (range.empty) {
      decorations.push(Decoration.widget({ widget: new EmptyStopWidget(range.active), side: 1 }).range(range.from));
      return;
    }
    decorations.push(stopMark(range.active).range(range.from, range.to));
  });
  return Decoration.set(decorations, true);
}
const snippetStopsField = StateField.define({
  create() {
    return { stops: [], decorations: Decoration.none };
  },
  update(value, transaction) {
    let stops = null;
    for (const effect of transaction.effects) {
      if (effect.is(snippetStopsEffect)) stops = effect.value;
    }
    if (stops) return { stops, decorations: buildDecorations(transaction.state, stops) };
    if (!transaction.docChanged || !value.stops.length) return value;
    const mapped = value.stops.map((stop) => ({
      ...stop,
      from: transaction.changes.mapPos(stop.from, -1),
      to: transaction.changes.mapPos(stop.to, 1)
    }));
    return { stops: mapped, decorations: buildDecorations(transaction.state, mapped) };
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations)
});
export {
  snippetStopsEffect,
  snippetStopsField
};
