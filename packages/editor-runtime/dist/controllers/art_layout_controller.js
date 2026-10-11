import { Controller } from "@hotwired/stimulus";
import { ArtLayoutMonitor } from "../lib/art_layout.js";
class art_layout_controller_default extends Controller {
  monitor = null;
  connect() {
    this.monitor = new ArtLayoutMonitor(this.element, this);
    this.monitor.start();
  }
  disconnect() {
    this.monitor?.destroy();
    this.monitor = null;
  }
  get roots() {
    return this.monitor?.roots ?? [];
  }
  get frame() {
    return this.monitor?.frameId ?? null;
  }
  get readFrame() {
    return this.monitor?.readFrameId ?? null;
  }
  schedule = (roots = null) => {
    this.monitor?.schedule(roots);
  };
  runDecisionPass() {
    this.monitor?.runDecisionPass();
  }
  runMeasurementPass(decisions) {
    this.monitor?.runMeasurementPass(decisions);
  }
  runFallbackMeasurement(decisions) {
    this.monitor?.runFallbackMeasurement(decisions);
  }
}
export {
  art_layout_controller_default as default
};
