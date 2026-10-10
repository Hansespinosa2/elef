import { Controller } from "@hotwired/stimulus"
import { ArtLayoutMonitor } from "../lib/art_layout.js"

// Shared Stimulus shell for fixed-host Art layout: boots one
// ArtLayoutMonitor per mounted element. Both hosts register this through
// registerEditorRuntime; the behavior lives in lib/art_layout once.
export default class extends Controller {
  private monitor: ArtLayoutMonitor | null = null

  connect(): void {
    this.monitor = new ArtLayoutMonitor(this.element)
    this.monitor.start()
  }

  disconnect(): void {
    this.monitor?.destroy()
    this.monitor = null
  }
}
