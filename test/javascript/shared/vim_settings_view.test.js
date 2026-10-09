import assert from "node:assert/strict"
import test from "node:test"
import { parseHTML } from "linkedom"
import { mountVimSettingsView } from "../../../app/javascript/lib/vim_settings_view.js"

test("the shared Vim settings view exposes every saved editor preference", () => {
  const { document } = parseHTML('<article data-controller="vim-settings" data-vim-settings-view></article>')
  const root = document.querySelector("article")

  mountVimSettingsView(root)

  assert.equal(root.querySelectorAll("[data-vim-settings-target]").length, 4)
  assert.equal(root.querySelector("[data-vim-settings-target='vimToggle']").type, "checkbox")
  assert.equal(root.querySelector("[data-vim-settings-target='escapeKey']").hasAttribute("readonly"), true)
  assert.deepEqual(
    Array.from(root.querySelectorAll("[data-vim-settings-target='lineNumbers'] option"), option => option.value),
    ["absolute", "relative", "off"]
  )
  assert.ok(root.querySelector("[data-action='vim-settings#clearEscapeKey']"))
  assert.ok(root.querySelector("[data-vim-settings-target='modeAwareCursor']"))

  const mounted = root.innerHTML
  mountVimSettingsView(root)
  assert.equal(root.innerHTML, mounted)
})
