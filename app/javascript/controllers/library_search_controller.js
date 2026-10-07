import { Controller } from "@hotwired/stimulus"
import { filterLibraryCards } from "controllers/library_search"

export default class extends Controller {
  filter() {
    filterLibraryCards(this.element, this.element.querySelector("#library-search").value)
  }
}
