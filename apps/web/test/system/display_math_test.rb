require "application_system_test_case"

# Display large operators (∑ ∏ ∫ …) resolve through the dedicated
# KaTeX_DisplayOps subset: WebKit paints a displaystyle large operator with
# the first listed family and never falls back per-glyph there, so the
# shared KaTeX_Main-first stack blanked every display ∑ on desktop Safari
# while Chromium (per-glyph fallback) kept rendering. This test pins the
# shipped rule in a real browser: the display sum must use DisplayOps first
# and occupy space.
class DisplayMathTest < ApplicationSystemTestCase
  SOURCE = <<~'MARKDOWN'
    # Sums

    $$
    CE = - \sum_{i=1}^{C} y_i
    $$
  MARKDOWN

  test "display sum resolves through the DisplayOps family" do
    document = Document.create!(title: "Sums", source: SOURCE)

    visit edit_document_path(document)
    assert_selector ".document-editor-projection .document-surface[data-document-pages-settled='true']", wait: 15

    assert_no_selector ".math-error"
    family = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const mo = document.querySelector(".document-surface munderover mo");
        if (!mo) return "missing";
        return getComputedStyle(mo).fontFamily;
      })()
    JAVASCRIPT
    assert_includes family, "KaTeX_DisplayOps"
    assert family.start_with?("KaTeX_DisplayOps"), "DisplayOps must lead, got: #{family}"

    width = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const mo = document.querySelector(".document-surface munderover mo");
        return mo ? mo.getBoundingClientRect().width : 0;
      })()
    JAVASCRIPT
    assert_operator width, :>, 0, "display sum operator must occupy space"
  end
end
