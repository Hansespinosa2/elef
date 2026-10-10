import { Controller } from "@hotwired/stimulus";
import { ArtLayoutMonitor } from "../lib/art_layout.js";
class art_layout_controller_default extends Controller {
  monitor = null;
  connect() {
    this.monitor = new ArtLayoutMonitor(this.element);
    this.monitor.start();
  }
  disconnect() {
    this.monitor?.destroy();
    this.monitor = null;
  }
}
export {
  art_layout_controller_default as default
};
