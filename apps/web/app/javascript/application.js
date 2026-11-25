// Configure your import map in config/importmap.rb. Read more: https://github.com/rails/importmap-rails
import "@hotwired/turbo-rails"
import "controllers"
import { setupAppToolbar } from "@elef/client"

document.addEventListener("elef:editor-mode-change", (event) => {
  document.body.classList.toggle("is-editing-source", event.detail?.mode === "source")
})
document.addEventListener("turbo:load", () => {
  setupAppToolbar()
  document.body.classList.toggle(
    "is-editing-source",
    Boolean(document.querySelector('.visual-editor-form[data-editor-mode="source"]'))
  )
})
