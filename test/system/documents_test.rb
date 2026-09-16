require "application_system_test_case"

class DocumentsTest < ApplicationSystemTestCase
  test "creates a document and updates its continuous live preview" do
    visit new_document_path
    assert_field "Title", with: ""
    fill_in "Title", with: "Research notes"
    fill_in "Markdown source", with: "# Research notes\n\nFirst section\n\n---\n\nSecond section"
    assert_selector ".document-surface", text: "Second section", wait: 5
    assert_selector ".document-surface hr"
    click_on "Save document"

    assert_text "Document saved."
    assert_current_path %r{/documents/\d+/edit}
    assert_selector ".document-surface h1", text: "Research notes"
    fill_in "Markdown source", with: "# Research notes\n\nA live update\n\n---\n\nSecond section"
    assert_selector ".document-surface", text: "A live update", wait: 5
    assert_includes Document.order(:id).last.source, "Second section"
  end

  test "expands math shorthand only when committed inside math" do
    document = Document.create!(title: "Math notes", source: "# Math")
    visit edit_document_path(document)
    editor = find_field("Markdown source")
    editor.click
    editor.send_keys(:end)
    editor.send_keys("\n$x.hat.b.T")
    editor.send_keys(:enter)

    assert_includes editor.value, "$\\mathbf{\\hat{x}}^{\\mathsf{T}}"
    assert_includes editor.value, "\n"
    assert_selector '[data-autosave-target="status"]', text: "Saved", wait: 5
  end

  test "canonicalizes modifier order and ignores code and unknown contexts" do
    document = Document.create!(title: "Math contexts", source: "# Math")
    visit edit_document_path(document)
    editor = find_field("Markdown source")
    source = "# Math\n\nOutside x.hat.b\n\n```\n$x.hat.b\n```\n\n$x.T.b.hat\n\n$x.unknown"
    page.execute_script(<<~JAVASCRIPT, source)
      const editor = document.querySelector('textarea[name="document[source]"]');
      editor.value = arguments[0];
      editor.focus();
      editor.setSelectionRange(editor.value.indexOf("\\n\\n$x.unknown"), editor.value.indexOf("\\n\\n$x.unknown"));
    JAVASCRIPT
    editor.send_keys(:tab)

    assert_includes editor.value, "Outside x.hat.b"
    assert_includes editor.value, "\n$x.hat.b\n```"
    assert_includes editor.value, "$\\mathbf{\\hat{x}}^{\\mathsf{T}}"

    page.execute_script("const editor = document.querySelector('textarea[name=\"document[source]\"]'); editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length);")
    editor.send_keys(:enter)
    assert_includes editor.value, "$x.unknown\n"
  end

  test "keeps the last good preview when a live preview fails" do
    document = Document.create!(title: "Stable notes", source: "# Stable notes\n\nLast good content")
    visit edit_document_path(document)
    assert_selector ".document-surface", text: "Last good content"

    page.execute_script(<<~JAVASCRIPT)
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        if (options.method === "POST" && String(url).includes("/preview")) {
          window.fetch = originalFetch;
          return Promise.resolve(new Response(JSON.stringify({
            html: null,
            warnings: ["The preview service rejected this edit."],
            revision: "failed-preview"
          }), { status: 422, headers: { "Content-Type": "application/json" } }));
        }
        return originalFetch(url, options);
      };
    JAVASCRIPT

    fill_in "Markdown source", with: "# Broken edit"
    assert_selector '[data-preview-target="status"]', text: "Preview unavailable", wait: 5
    assert_selector '[data-preview-target="warnings"]', text: "The preview service rejected this edit."
    assert_selector ".document-surface", text: "Last good content"
    assert_no_selector ".document-surface", text: "Broken edit"
  end
end
