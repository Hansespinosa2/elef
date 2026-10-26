import { Controller } from "@hotwired/stimulus"
import { mountAppNavigation } from "@elef/client"

export default class extends Controller {
  static values = { library: String, settings: String, active: String }

  connect() {
    this.navigation = mountAppNavigation(this.element, {
      libraryHref: this.libraryValue,
      settingsHref: this.settingsValue,
      active: this.activeValue === "settings" ? "settings" : "library"
    })
  }

  disconnect() { this.navigation?.dispose() }
}
