import { Controller } from "@hotwired/stimulus"
import { SlideOverview } from "@elef/client"
import { bindEditorAction } from "lib/editor_actions"

// Thin host adapter: all overview state, slide operations, slide-range source
// math, card rendering, and overflow measurement live in the client
// SlideOverview feature. This controller only wires Stimulus targets and
// actions to it.
export default class extends Controller {
  static targets = ["grid", "count", "warnings"]

  connect() {
    this.overview = new SlideOverview({
      element: this.element,
      targets: {
        grid: this.hasGridTarget ? this.gridTarget : null,
        count: this.hasCountTarget ? this.countTarget : null,
        warnings: this.hasWarningsTarget ? this.warningsTarget : null
      }
    })
    this.overview.connect()
    // Neutral client contract for the overview cards the feature renders;
    // the `select` action stays for compatibility.
    this.unbindEditorActions = bindEditorAction(this.element, "overview-select", (event) => this.overview.select(event))
  }

  disconnect() {
    this.unbindEditorActions?.()
    this.overview?.disconnect()
  }

  sourceChanged() {
    this.overview.sourceChanged()
  }

  previewUpdated() {
    this.overview.previewUpdated()
  }

  select(event) {
    this.overview.select(event)
  }

  add() {
    this.overview.add()
  }

  duplicate() {
    this.overview.duplicate()
  }

  delete() {
    this.overview.delete()
  }

  moveUp() {
    this.overview.moveUp()
  }

  moveDown() {
    this.overview.moveDown()
  }

  // Shared source math other controllers (media insertion) read through the
  // registered adapter; the implementation lives in the client feature.
  sourceRanges(source) {
    return this.overview?.sourceRanges(source) ?? []
  }
}
