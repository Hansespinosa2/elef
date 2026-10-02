import { Controller } from "@hotwired/stimulus"
import { filterLibraryCards } from "./library_search.js"

export default class extends Controller {
  filter() {
    filterLibraryCards(this.element, this.element.querySelector("#library-search").value)
  }
}
