import { Controller } from "@hotwired/stimulus"
import { ArtLayoutMonitor } from "../lib/art_layout.js"
import type { ArtDecision } from "../lib/art_layout.js"

// Shared Stimulus shell for fixed-host Art layout: boots one
// ArtLayoutMonitor per mounted element. Both hosts register this through
// registerEditorRuntime; the behavior lives in lib/art_layout once.
//
// The controller re-exposes the monitor's batched lifecycle surface
// (roots/schedule plus the decision → measurement → fallback passes) so
// lifecycle probes observe the same pass sequence the standalone monitor
// runs. The monitor routes its chained passes back through this adapter,
// which keeps wrapped pass methods observable.
export default class extends Controller {
  private monitor: ArtLayoutMonitor | null = null

  connect(): void {
    this.monitor = new ArtLayoutMonitor(this.element, this)
    this.monitor.start()
  }

  disconnect(): void {
    this.monitor?.destroy()
    this.monitor = null
  }

  get roots(): Array<Element> {
    return this.monitor?.roots ?? []
  }

  get frame(): number | null {
    return this.monitor?.frameId ?? null
  }

  get readFrame(): number | null {
    return this.monitor?.readFrameId ?? null
  }

  schedule = (roots: Iterable<Element> | null = null): void => {
    this.monitor?.schedule(roots)
  }

  runDecisionPass(): void {
    this.monitor?.runDecisionPass()
  }

  runMeasurementPass(decisions: Array<ArtDecision>): void {
    this.monitor?.runMeasurementPass(decisions)
  }

  runFallbackMeasurement(decisions: Array<ArtDecision>): void {
    this.monitor?.runFallbackMeasurement(decisions)
  }
}
