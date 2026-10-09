require "application_system_test_case"
require "base64"
require "fileutils"

class MediaPdfExportTest < ApplicationSystemTestCase
  test "uploaded browser screenshot and inline math survive document and presentation PDF printing" do
    origin = Document.create!(source: "# SCREENSHOT ORIGIN\n\nA recognizable image made by this browser.")
    visit document_path(origin)
    assert_selector ".document-surface h1", text: "SCREENSHOT ORIGIN"

    screenshot_dir = Rails.root.join("tmp/pdfs")
    FileUtils.mkdir_p(screenshot_dir)
    screenshot_path = screenshot_dir.join("origin-screen.png")
    page.save_screenshot(screenshot_path)
    assert_operator File.size(screenshot_path), :>, 1_000

    [Document, Presentation].each do |model|
      work = model.create!(source: "# #{model.name} PDF probe")
      visit model == Document ? edit_document_path(work) : edit_presentation_path(work)
      page.execute_script("document.querySelector('[data-media-target=input]').hidden = false")
      find('[data-media-target="input"]').set(screenshot_path.to_s)
      assert_selector ".media-upload-status", text: /added to the Markdown source/i, wait: 10
      uploaded_source = find_field("Markdown source").value
      assert_match(/elef-asset:[0-9a-f]{64}/, uploaded_source)

      image_markdown = uploaded_source.match(/!\[[^\]]*\]\(elef-asset:[^)]+\)/)[0]
      prefix = "# #{model.name} PDF probe\n\nPDF equation: $\\bar{x}$\n\n"
      source = prefix + (model == Document ? image_markdown : "---\n\n#{image_markdown}")
      page.execute_script(<<~JAVASCRIPT, source)
        const editor = document.querySelector('.source-field').editorController;
        editor.replaceRange(arguments[0], 0, editor.value.length);
      JAVASCRIPT
      assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 10

      visit model == Document ? print_document_path(work) : print_presentation_path(work)
      image_selector = model == Document ? ".document-print img.presentation-media" : ".presentation-print img.presentation-media"
      assert_selector image_selector
      assert_operator page.evaluate_script("document.querySelector(#{image_selector.to_json}).naturalWidth"), :>, 0
      assert_selector ".katex-html", minimum: 1, visible: :all
      assert_no_text '$\\bar{x}$'
      if model == Presentation
        assert_equal "rgb(37, 42, 39)", page.evaluate_script("getComputedStyle(document.querySelector('.presentation-print .slide')).color")
      end

      pdf = Base64.decode64(page.driver.browser.execute_cdp("Page.printToPDF", printBackground: true, preferCSSPageSize: true).fetch("data"))
      assert pdf.start_with?("%PDF-")
      assert_match %r{/Subtype\s*/Image\b}, pdf

      if (output_dir = ENV["ELEF_PDF_PROBE_OUTPUT"])
        FileUtils.mkdir_p(output_dir)
        File.binwrite(File.join(output_dir, "#{model.name.downcase}-image-math.pdf"), pdf)
      end
    end
  end
end
