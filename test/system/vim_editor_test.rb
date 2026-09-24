require "application_system_test_case"

class VimEditorTest < ApplicationSystemTestCase
  test "editor controls fit a narrow viewport and retain resizing" do
    document = Document.create!(title: "Mobile editor", source: "# Mobile")
    visit edit_document_path(document)
    [500, 390, 320].each do |width|
      page.driver.browser.execute_cdp("Emulation.setDeviceMetricsOverride", width: width, height: 800, deviceScaleFactor: 1, mobile: false)
      assert_operator page.evaluate_script("document.documentElement.scrollWidth"), :<=,
        page.evaluate_script("window.innerWidth")
    end

    page.driver.browser.execute_cdp("Emulation.setDeviceMetricsOverride", width: 500, height: 800, deviceScaleFactor: 1, mobile: false)
    assert_equal "vertical", page.evaluate_script("getComputedStyle(document.querySelector('.editor-surface')).resize")
    assert_equal "hidden", page.evaluate_script("getComputedStyle(document.querySelector('.editor-surface')).overflow")

    find("summary", text: "Vim settings").click
    panel = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const rect = document.querySelector('.editor-settings-panel').getBoundingClientRect()
        return { left: rect.left, right: rect.right, width: rect.width }
      })()
    JAVASCRIPT
    assert_operator panel["left"], :>=, 0
    assert_operator panel["right"], :<=, page.evaluate_script("window.innerWidth")
    save_screenshot("tmp/screenshots/editor/mobile-vim-settings.png")
  ensure
    page.driver.browser.execute_cdp("Emulation.clearDeviceMetricsOverride")
    page.driver.browser.manage.window.resize_to(1400, 1000)
  end

  test "Vim mode transitions and edits synchronize the Rails source" do
    document = Document.create!(title: "Vim notes", source: "# First\n# Second\n# Third")
    visit edit_document_path(document)

    find("summary", text: "Vim settings").click
    find("[data-editor-target='vimToggle']").check
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
    find("summary", text: "Vim settings").click

    editor = find(".cm-content")
    editor.click
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")
    editor.send_keys("i")
    assert_selector "[data-editor-target='mode'][data-mode='insert']", text: "Insert"
    editor.send_keys("Inserted ", :escape)
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
    editor.send_keys("v", "l")
    assert_selector "[data-editor-target='mode'][data-mode='visual']", text: "Visual"
    editor.send_keys(:escape)

    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")
    editor.send_keys("dd")
    assert_equal "# Second\n# Third", find_field("Markdown source").value
    assert_selector "[data-autosave-target='status']", text: "Saved", wait: 5
  end

  test "Vim visual mode highlights horizontal selections with the Aradia palette" do
    document = Document.create!(title: "Visual selection", source: "abcdef\nsecond line")
    visit edit_document_path(document)

    find("summary", text: "Vim settings").click
    find("[data-editor-target='vimToggle']").check
    find("summary", text: "Vim settings").click

    editor = find(".cm-content")
    editor.click
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(3, 3)")
    editor.send_keys("v", "h")
    assert_selector "[data-editor-target='mode'][data-mode='visual']", text: "Visual"

    selection = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController
        const selected = document.querySelector('.cm-selectionBackground')
        const bounds = selected?.getBoundingClientRect()
        return {
          from: editor.view.state.selection.main.from,
          to: editor.view.state.selection.main.to,
          background: selected && getComputedStyle(selected).backgroundColor,
          width: bounds?.width || 0
        }
      })()
    JAVASCRIPT

    assert_operator selection["to"], :>, selection["from"]
    assert_operator selection["width"], :>, 0
    editor.send_keys("h")
    page.evaluate_async_script("window.requestAnimationFrame(() => arguments[0]())")
    extended_selection = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController
        const selected = document.querySelector('.cm-selectionBackground')
        return {
          from: editor.view.state.selection.main.from,
          to: editor.view.state.selection.main.to,
          background: selected && getComputedStyle(selected).backgroundColor,
          width: selected?.getBoundingClientRect().width || 0
        }
      })()
    JAVASCRIPT
    assert_operator extended_selection["to"] - extended_selection["from"], :>, selection["to"] - selection["from"]
    assert_operator extended_selection["width"], :>, selection["width"]
    assert_equal "rgba(159, 197, 169, 0.42)", extended_selection["background"]
  end

  test "Vim settings persist per browser" do
    document = Document.create!(title: "Vim settings", source: "# Settings")
    visit edit_document_path(document)

    find("summary", text: "Vim settings").click
    find("[data-editor-target='vimToggle']").check
    visit edit_document_path(document)

    find("summary", text: "Vim settings").click
    assert_selector "[data-editor-target='vimToggle']:checked"
    assert_no_selector "[data-editor-target='mapping']"
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
  end

  test "customizes Vim Escape, line numbers, cursor styling, and persists" do
    document = Document.create!(title: "Expanded Vim settings", source: "# Settings\nSecond\nThird\nFourth")
    visit edit_document_path(document)
    page.execute_script("localStorage.clear()")
    page.refresh

    find("summary", text: "Vim settings").click
    escape_key = find("[data-editor-target='escapeKey']")
    escape_key.click
    escape_key.send_keys([:shift, :space])
    assert_equal "Shift+Space", escape_key.value

    select "Hidden", from: "Line numbers"
    assert_equal "none", page.evaluate_script("getComputedStyle(document.querySelector('.cm-lineNumbers')).display")
    select "Relative", from: "Line numbers"
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")
    line_numbers = <<~JAVASCRIPT
      [...document.querySelectorAll('.cm-lineNumbers .cm-gutterElement')]
        .filter((element) => element.style.visibility !== 'hidden')
        .map((element) => element.textContent)
    JAVASCRIPT
    page.evaluate_async_script("window.requestAnimationFrame(() => arguments[0]())")
    assert_equal %w[0 1 2 3], page.evaluate_script(line_numbers)
    page.execute_script("const editor = document.querySelector('.source-field').editorController; editor.setSelectionRange(editor.value.indexOf('Third'))")
    page.evaluate_async_script("window.requestAnimationFrame(() => arguments[0]())")
    assert_equal %w[2 1 0 1], page.evaluate_script(line_numbers)
    select "Absolute", from: "Line numbers"
    page.evaluate_async_script("window.requestAnimationFrame(() => arguments[0]())")
    assert_equal %w[1 2 3 4], page.evaluate_script(line_numbers)
    select "Relative", from: "Line numbers"
    check "Mode-aware cursor styling"
    check "Enable Vim mode in this browser"
    assert_equal "relative", page.evaluate_script("document.querySelector('.editor-surface').dataset.lineNumbers")
    assert_equal "true", page.evaluate_script("document.querySelector('.editor-surface').dataset.modeAwareCursor")
    find("summary", text: "Vim settings").click

    editor = find(".cm-content")
    editor.click
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")
    editor.send_keys("i")
    assert_equal "rgb(215, 194, 142)", page.evaluate_script("getComputedStyle(document.querySelector('.cm-cursor')).borderLeftColor")
    editor.send_keys("Alias", [:shift, :space])
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
    assert_equal "rgb(159, 197, 169)", page.evaluate_script("getComputedStyle(document.querySelector('.cm-cursor')).borderLeftColor")
    editor.send_keys("v", "l")
    assert_selector "[data-editor-target='mode'][data-mode='visual']", text: "Visual"
    assert_equal "rgb(196, 214, 202)", page.evaluate_script("getComputedStyle(document.querySelector('.cm-cursor')).borderLeftColor")
    editor.send_keys([:shift, :space])
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"

    visit edit_document_path(document)
    find("summary", text: "Vim settings").click
    assert_equal "relative", find("[data-editor-target='lineNumbers']").value
    assert_selector "[data-editor-target='modeAwareCursor']:checked"
    assert_equal "Shift+Space", find("[data-editor-target='escapeKey']").value
  end

  test "metadata directives use the same styling as Markdown markers" do
    document = Document.create!(title: "Metadata styling", source: <<~MARKDOWN)
      # Notes

      > A quote

      **Bold**

      :::position{center}

      Visible text.

      ```
      :::not-metadata
      ```
    MARKDOWN
    visit edit_document_path(document)

    styles = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const find = (text) => [...document.querySelectorAll(".cm-line span")].find((node) => node.textContent === text)
        const describe = (node) => node && ({
          className: node.className,
          color: getComputedStyle(node).color,
          opacity: getComputedStyle(node).opacity,
          fontStyle: getComputedStyle(node).fontStyle
        })

        const metadata = find(":::position{center}")
        const heading = find("#")
        const quote = find(">")
        const strong = find("**")
        const metadataClasses = metadata ? [...metadata.classList] : []
        const sharedClass = metadataClasses.find((className) => [heading, quote, strong].every((node) => node?.classList.contains(className)))

        return {
          metadata: describe(metadata),
          heading: describe(heading),
          quote: describe(quote),
          strong: describe(strong),
          sharedClass,
          fenced: describe(find(":::not-metadata"))
        }
      })()
    JAVASCRIPT

    refute_nil styles["sharedClass"]
    %w[color opacity fontStyle].each do |property|
      assert_equal styles["metadata"][property], styles["heading"][property]
      assert_equal styles["metadata"][property], styles["quote"][property]
      assert_equal styles["metadata"][property], styles["strong"][property]
    end
    assert_nil styles["fenced"]
  end

  test "Vim edits update a presentation preview and autosave" do
    presentation = Presentation.create!(title: "Vim deck", source: "# Original")
    visit edit_presentation_path(presentation)

    find("summary", text: "Vim settings").click
    find("[data-editor-target='vimToggle']").check
    find("summary", text: "Vim settings").click

    editor = find(".cm-content")
    editor.click
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(2, 2)")
    editor.send_keys("i", "Vim ", :escape)

    assert_selector ".preview-pane .slide", text: "Vim Original", wait: 5
    assert_selector "[data-autosave-target='status']", text: "Saved", wait: 5
    assert_includes presentation.reload.source, "# Vim Original"
  end

  test "turning Vim off restores ordinary editing" do
    document = Document.create!(title: "Standard editing", source: "# Standard")
    visit edit_document_path(document)

    find("summary", text: "Vim settings").click
    find("[data-editor-target='vimToggle']").check
    find("[data-editor-target='vimToggle']").uncheck
    assert_selector "[data-editor-target='mode'][data-mode='standard']", text: "Standard"
    find("summary", text: "Vim settings").click

    editor = find(".cm-content")
    editor.click
    editor.send_keys(" ordinary")
    assert_includes find_field("Markdown source").value, " ordinary"
  end
end
