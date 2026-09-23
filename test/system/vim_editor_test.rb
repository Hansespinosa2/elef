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

  test "Vim settings persist per browser" do
    document = Document.create!(title: "Vim settings", source: "# Settings")
    visit edit_document_path(document)

    find("summary", text: "Vim settings").click
    find("[data-editor-target='vimToggle']").check
    select "Enter Insert mode", from: "Shift+Space in Normal mode"
    visit edit_document_path(document)

    find("summary", text: "Vim settings").click
    assert_selector "[data-editor-target='vimToggle']:checked"
    assert_equal "insert", find("[data-editor-target='mapping']").value
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"
  end

  test "customizes Insert Escape, line numbers, cursor styling, and persists" do
    document = Document.create!(title: "Expanded Vim settings", source: "# Settings")
    visit edit_document_path(document)
    page.execute_script("localStorage.clear()")
    page.refresh

    find("summary", text: "Vim settings").click
    select "Escape or Shift+Space", from: "Escape aliases in Insert mode"
    select "Relative", from: "Line numbers"
    check "Mode-aware cursor styling"
    check "Enable Vim mode in this browser"
    assert_equal "relative", page.evaluate_script("document.querySelector('.editor-surface').dataset.lineNumbers")
    assert_equal "true", page.evaluate_script("document.querySelector('.editor-surface').dataset.modeAwareCursor")
    find("summary", text: "Vim settings").click

    editor = find(".cm-content")
    editor.click
    page.execute_script("document.querySelector('.source-field').editorController.setSelectionRange(0, 0)")
    editor.send_keys("i", "Alias", [:shift, :space])
    assert_selector "[data-editor-target='mode'][data-mode='normal']", text: "Normal"

    visit edit_document_path(document)
    find("summary", text: "Vim settings").click
    assert_equal "relative", find("[data-editor-target='lineNumbers']").value
    assert_selector "[data-editor-target='modeAwareCursor']:checked"
    assert_equal "shift-space", find("[data-editor-target='escapeAlias']").value
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

  test "configured Shift+Space enters Insert mode" do
    document = Document.create!(title: "Vim mapping", source: "# Mapping")
    visit edit_document_path(document)

    find("summary", text: "Vim settings").click
    find("[data-editor-target='vimToggle']").check
    select "Enter Insert mode", from: "Shift+Space in Normal mode"
    find("summary", text: "Vim settings").click

    editor = find(".cm-content")
    editor.click
    editor.send_keys([:shift, :space])
    assert_selector "[data-editor-target='mode'][data-mode='insert']", text: "Insert"
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
