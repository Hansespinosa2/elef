require "application_system_test_case"

# Exercise genuine input without resetting the caret or blurring between
# commands. Source correctness alone misses a stale focused projection.
class ContinuousAuthoringTest < ApplicationSystemTestCase
  SOURCE = "# Authoring\n\nalpha beta gamma\n\nSecond paragraph.\n\nFinal paragraph.\n".freeze

  def mount_continuous_surface
    result = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      import('@elef/client/continuous-editor').then(async ({ mountContinuousDocument }) => {
        await mountContinuousDocument(document.querySelector('.source-field').editorController);
        done('mounted');
      }).catch(error => done(String(error)));
    JAVASCRIPT
    assert_equal "mounted", result
  end

  test "visual Vim changes remain visible throughout an uninterrupted session" do
    document = Document.create!(title: "Authoring", source: SOURCE)
    visit edit_document_path(document)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_continuous_surface
    assert_selector ".continuous-document", visible: :all
    block = find(".continuous-document .cm-line", text: "alpha beta gamma")
    block.click
    assert_equal "alpha beta gamma", page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const editor = document.querySelector('.source-field').editorController;
        return editor.view.state.doc.lineAt(editor.selectionHead).text;
      })()
    JAVASCRIPT
    block.send_keys("0dw")
    assert_field "Markdown source", with: SOURCE.sub("alpha beta", "beta")
    assert_selector ".continuous-document .cm-line", exact_text: "beta gamma"
    page.driver.browser.action.send_keys("u").perform
    assert_field "Markdown source", with: SOURCE
    assert_selector ".continuous-document .cm-line", exact_text: "alpha beta gamma"
  end

  test "rendered tables keep cell text editable by the document Vim engine" do
    source = "# Tables\n\n| Name | Value |\n| --- | --- |\n| alpha | beta |\n"
    document = Document.create!(title: "Tables", source: source)
    visit edit_document_path(document)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_continuous_surface
    cell = find(".continuous-document .cm-continuous-cell", text: "alpha")
    cell.click
    page.driver.browser.action.send_keys("0facw", "gamma", :escape).perform
    assert_field "Markdown source", with: source.sub("alpha", "gamma")
    assert_selector ".continuous-document .cm-continuous-cell", exact_text: "gamma"
    assert_selector ".continuous-document .cm-continuous-cell", exact_text: "beta"
    assert_equal 1, page.evaluate_script("document.querySelector('.continuous-document').querySelectorAll('[contenteditable=true]').length")
  end

  test "continuous table columns preserve the renderer layout instead of equalizing widths" do
    source = "# Table layout\n\n| Parameter | Value |\n| --- | ---: |\n| A much longer parameter description that should receive more width | 2 |\n"
    document = Document.create!(title: "Table layout", source: source)
    visit document_path(document)
    assert_selector ".document-reader table"
    expected = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const table = document.querySelector('.document-reader table');
        return [...table.querySelectorAll('th')].map(cell => cell.getBoundingClientRect().width / table.getBoundingClientRect().width);
      })()
    JAVASCRIPT
    reader_style = page.evaluate_script("(() => { const t = document.querySelector('.document-reader table'); const s = getComputedStyle(t.querySelector('th')); return {width:t.getBoundingClientRect().width,font:s.font,padding:s.padding}; })()")
    visit edit_document_path(document)
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_continuous_surface
    find(".continuous-document .cm-content").send_keys([:control, :end])
    actual = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const row = document.querySelector('.cm-continuous-table-header');
        if (!row) throw new Error(document.querySelector('.continuous-document .cm-content').innerHTML);
        return [...row.querySelectorAll('.cm-continuous-cell')].map(cell => cell.getBoundingClientRect().width / row.getBoundingClientRect().width);
      })()
    JAVASCRIPT
    assert_equal expected.length, actual.length
    probe_style = page.evaluate_script("(() => { const t = document.querySelector('.continuous-table-measure table'); const s = getComputedStyle(t.querySelector('th')); return {width:t.getBoundingClientRect().width,font:s.font,padding:s.padding}; })()")
    expected.zip(actual).each { |reader, editor| assert_in_delta reader, editor, 0.005, "reader #{reader_style.inspect}; probe #{probe_style.inspect}" }
  end

  test "source switches and saves preserve the same editor state and visual changes" do
    document = Document.create!(title: "Authoring", source: SOURCE)
    visit edit_document_path(document)
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_continuous_surface
    find(".continuous-document .cm-line", text: "alpha beta gamma").click
    page.driver.browser.action.send_keys(:end, " delta").perform
    expected = SOURCE.sub("alpha beta gamma", "alpha beta gamma delta")
    assert_field "Markdown source", with: expected
    page.execute_script("window.authoringView = document.querySelector('.source-field').editorController.view")
    click_on "Source"
    assert_no_selector ".continuous-document"
    assert_match /mono/i, page.evaluate_script("getComputedStyle(document.querySelector('.source-field .cm-scroller')).fontFamily")
    assert_equal "pre", page.evaluate_script("getComputedStyle(document.querySelector('.source-field .cm-content')).whiteSpace")
    click_on "Visual"
    assert_selector ".continuous-document .cm-line", exact_text: "alpha beta gamma delta"
    assert page.evaluate_script("window.authoringView === document.querySelector('.source-field').editorController.view")
    click_on "Save document"
    assert_text "Document saved."
    assert_equal expected, document.reload.source
    visit edit_document_path(document)
    assert_field "Markdown source", with: expected
  end

  test "continuous prose preserves reader soft breaks, typography, and vertical spacing" do
    source = "# Typography\n\nA short source line\ncontinues in the same paragraph.\n\n## Next section\n\nA final paragraph.\n"
    document = Document.create!(title: "Typography", source: source)
    visit document_path(document)
    expected = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const nodes = [...document.querySelectorAll('.document-surface h1, .document-surface h2, .document-surface p')];
        const top = nodes[0].getBoundingClientRect().top;
        return nodes.map(node => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
          const clone = node.cloneNode(true); clone.querySelectorAll('.cm-live-syntax-marker, .cm-widgetBuffer').forEach(marker => marker.remove());
          return {text:clone.textContent.trim().replace(/\\s+/g,' '), top:rect.top-top, height:rect.height, font:style.font}; });
      })()
    JAVASCRIPT
    visit edit_document_path(document)
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_continuous_surface
    find(".continuous-document .cm-content").send_keys([:control, :end])
    actual = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const nodes = [...document.querySelectorAll('.continuous-document .cm-line')].filter(node => node.textContent.trim());
        const top = nodes[0].getBoundingClientRect().top;
        return nodes.map(node => { const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
          const clone = node.cloneNode(true); clone.querySelectorAll('.cm-live-syntax-marker, .cm-widgetBuffer').forEach(marker => marker.remove());
          return {text:clone.textContent.trim().replace(/\\s+/g,' '), top:rect.top-top, height:rect.height, font:style.font}; });
      })()
    JAVASCRIPT
    assert_equal expected.length, actual.length, actual.inspect
    expected.zip(actual).each do |reader, editor|
      assert_equal reader["text"], editor["text"]
      assert_equal reader["font"], editor["font"]
      assert_in_delta reader["height"], editor["height"], 1
      assert_in_delta reader["top"], editor["top"], 1
    end
  end

  test "Vim can edit an equation and leave it rendered without a projection refresh" do
    source = "# Math\n\nEquation $x^2$.\n\nAfter.\n"
    document = Document.create!(title: "Math", source: source)
    visit edit_document_path(document)
    page.execute_script("localStorage.setItem('elef.editor.vim.enabled', 'true')")
    page.refresh
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])"
    mount_continuous_surface
    page.driver.browser.action.send_keys("ggjjfxryG").perform
    assert_field "Markdown source", with: source.sub("$x^2$", "$y^2$")
    assert_selector ".continuous-document math", text: /y/
    page.driver.browser.action.send_keys("u").perform
    assert_field "Markdown source", with: source
    assert_selector ".continuous-document .cm-line", text: "$x^2$"
    page.driver.browser.action.send_keys("G").perform
    assert_selector ".continuous-document math", text: /x/
  end
end
