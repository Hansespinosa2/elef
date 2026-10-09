import assert from "node:assert/strict"
import { $, browser } from "@wdio/globals"
import { exportAndVerifyDiagnostics } from "./diagnostics-archive.js"
import {
  STABLE_PROFILE_DECK_TITLE,
  STABLE_PROFILE_EDITED_SOURCE,
  STABLE_PROFILE_KEYBOARD_SOURCE,
  STABLE_PROFILE_SOURCE
} from "./stable-profile-fixture.js"

describe("Stable profile exclusions", () => {
  it("keeps experimental entry points unreachable and preserves literal source", async () => {
    await $("#library-view").waitForDisplayed()
    await $(`[aria-label='Edit ${STABLE_PROFILE_DECK_TITLE}']`).click()
    await browser.waitUntil(async () => browser.execute(() => {
      const field = document.querySelector("#desktop-editor-field")
      return Boolean(field?.editorController?.editorReady && !document.querySelector("#deck-view").hidden)
    }), { timeout: 15_000, timeoutMsg: "Stable profile fixture did not open in the source editor" })

    const state = await browser.execute(() => {
      const field = document.querySelector("#desktop-editor-field")
      const form = document.querySelector("#desktop-editor-form")
      const controller = (element, identifier) => Boolean(window.Stimulus?.getControllerForElementAndIdentifier(element, identifier))
      return {
        source: field.editorController.sourceValue,
        fieldControllers: field.dataset.controller || "",
        formControllers: form.dataset.controller || "",
        fieldActions: field.querySelector(".editor-input-proxy")?.dataset.action || "",
        excludedUi: [
          "#visual-mode",
          ".presentation-editor-tools",
          ".slide-overview",
          ".presentation-editor-slide-toolbar",
          ".presentation-editor-block-controls",
          ".document-block-position-control",
          "#document-graph-view",
          "[data-library-tab='graph']",
          "[data-document-link-palette-target]",
          "[aria-label='Document link suggestions']"
        ].filter(selector => document.querySelector(selector)),
        excludedControllers: [
          controller(field, "visual-editor"),
          controller(field, "presentation-editor"),
          controller(field, "slide-overview"),
          controller(field, "document-link-palette"),
          controller(form, "document-graph"),
          controller(document.querySelector("#deck-list"), "lineage-graph")
        ],
        revisionsEnabled: document.documentElement.dataset.elefRevisionsEnabled,
        lineageEnabled: document.documentElement.dataset.elefLineageEnabled,
        revisionControls: [...document.querySelectorAll("[data-desktop-feature='revisions']")]
          .filter(element => !element.hidden && element.getAttribute("aria-hidden") !== "true").length,
        lineageControls: [...document.querySelectorAll("[data-desktop-feature='lineage']")]
          .filter(element => !element.hidden && element.getAttribute("aria-hidden") !== "true").length
      }
    })
    assert.equal(state.source, STABLE_PROFILE_SOURCE)
    assert.equal(state.revisionsEnabled, "false")
    assert.equal(state.lineageEnabled, "false")
    assert.deepEqual(state.excludedUi, [])
    assert.deepEqual(state.excludedControllers, [false, false, false, false, false, false])
    assert.equal(state.revisionControls, 0)
    assert.equal(state.lineageControls, 0)
    assert.doesNotMatch(state.fieldControllers, /document-link-palette|visual-editor|presentation-editor|slide-overview/)
    assert.doesNotMatch(state.formControllers, /document-graph|lineage-graph/)
    assert.doesNotMatch(state.fieldActions, /document-link-palette/)

    await browser.waitUntil(async () => browser.execute(() => {
      const preview = document.querySelector("#desktop-preview")
      return preview?.textContent.includes("Unknown syntax stays literal: [[E2E linked]].") &&
        Boolean(preview.querySelector("a[href='https://example.com']"))
    }), { timeout: 10_000, timeoutMsg: "Stable preview changed literal brackets or ordinary Markdown links" })

    const graphCommandReachable = await browser.executeAsync(done => {
      window.__TAURI__.core.invoke("document_graph").then(
        () => done(true),
        () => done(false)
      )
    })
    assert.equal(graphCommandReachable, false, "Stable must not register or grant the document graph command")

    const changed = await browser.execute(source => {
      const editor = document.querySelector("#desktop-editor-field").editorController
      editor.replaceRange(source, 0, editor.sourceValue.length)
      return editor.sourceValue
    }, STABLE_PROFILE_EDITED_SOURCE)
    assert.equal(changed, STABLE_PROFILE_EDITED_SOURCE)
    const sourceInput = $("#desktop-editor-field .cm-content")
    await browser.execute(() => {
      const editor = document.querySelector("#desktop-editor-field").editorController
      editor.view.dispatch({ selection: { anchor: editor.sourceValue.length } })
      editor.focus()
    })
    await sourceInput.keys("[[")
    await browser.waitUntil(async () => browser.execute(source =>
      document.querySelector("#desktop-editor-field")?.editorController?.sourceValue === source,
    STABLE_PROFILE_KEYBOARD_SOURCE), {
      timeout: 10_000,
      timeoutMsg: "Typing [[ in Stable should leave literal source without opening document-link suggestions"
    })
    assert.equal(await $("[data-document-link-palette-target]").isExisting(), false)
    await browser.waitUntil(async () => browser.execute(source =>
      document.querySelector("#save-state")?.dataset.state === "saved" &&
      document.querySelector("#desktop-editor-field")?.editorController?.sourceValue === source,
    STABLE_PROFILE_KEYBOARD_SOURCE), {
      timeout: 15_000,
      timeoutMsg: "Stable did not save the edited source with the unknown directive intact"
    })

    await $("#back-to-library").click()
    await $("#library-view").waitForDisplayed()
    await $(`[aria-label='Edit ${STABLE_PROFILE_DECK_TITLE}']`).click()
    await browser.waitUntil(async () => browser.execute(source =>
      document.querySelector("#desktop-editor-field")?.editorController?.sourceValue === source,
    STABLE_PROFILE_KEYBOARD_SOURCE), {
      timeout: 15_000,
      timeoutMsg: "Stable did not reopen the exact saved source"
    })
    await exportAndVerifyDiagnostics(browser, "stable")
  })
})
