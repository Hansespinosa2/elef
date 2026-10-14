import { Controller } from "@hotwired/stimulus";
import { SlideOverview } from "@elef/client";
import { bindEditorAction } from "../lib/editor_actions.js";
class slide_overview_controller_default extends Controller {
  static targets = ["grid", "count", "warnings"];
  connect() {
    this.overview = new SlideOverview({
      element: this.element,
      targets: {
        grid: this.hasGridTarget ? this.gridTarget : null,
        count: this.hasCountTarget ? this.countTarget : null,
        warnings: this.hasWarningsTarget ? this.warningsTarget : null
      }
    });
    this.overview.connect();
    this.unbindEditorActions = bindEditorAction(this.element, "overview-select", (event) => this.overview.select(event));
  }
  disconnect() {
    this.unbindEditorActions?.();
    this.overview?.disconnect();
  }
  sourceChanged() {
    this.overview.sourceChanged();
  }
  previewUpdated() {
    this.overview.previewUpdated();
  }
  select(event) {
    this.overview.select(event);
  }
  add() {
    this.overview.add();
  }
  duplicate() {
    this.overview.duplicate();
  }
  delete() {
    this.overview.delete();
  }
  moveUp() {
    this.overview.moveUp();
  }
  moveDown() {
    this.overview.moveDown();
  }
  // Shared source math other controllers (media insertion) read through the
  // registered adapter; the implementation lives in the client feature.
  sourceRanges(source) {
    return this.overview?.sourceRanges(source) ?? [];
  }
}
export {
  slide_overview_controller_default as default
};
