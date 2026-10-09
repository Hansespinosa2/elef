require "application_system_test_case"

class ClientLibraryTest < ApplicationSystemTestCase
  test "library deep links resolve through the client shell" do
    Presentation.delete_all
    Document.create!(title: "Shell document", source: "# Shell document")
    Presentation.create!(title: "Shell deck", source: "# Shell deck")

    visit "/"
    assert_selector "[data-elef-shell]", wait: 10
    assert_selector "#library-title", text: "Library"
    assert_selector "article.library-card", count: 2
    assert_selector '[data-library-tab="all"][aria-current="page"]'

    visit "/documents"
    assert_selector "[data-elef-shell]", wait: 10
    assert_selector "article.library-card", count: 1
    assert_selector "article.library-card", text: "Shell document"
    assert_selector '[data-library-tab="documents"][aria-current="page"]'

    visit "/presentations"
    assert_selector "[data-elef-shell]", wait: 10
    assert_selector "article.library-card", count: 1
    assert_selector "article.library-card", text: "Shell deck"
    assert_selector '[data-library-tab="presentations"][aria-current="page"]'
  end

  test "library tabs switch filters through the client shell without reloads" do
    Presentation.delete_all
    Document.create!(title: "Tab document", source: "# Tab document")
    Presentation.create!(title: "Tab deck", source: "# Tab deck")

    visit "/"
    assert_selector "[data-elef-shell]", wait: 10
    assert_selector "article.library-card", count: 2

    find('[data-library-tab="documents"]').click
    assert_selector "article.library-card", count: 1
    assert_selector "article.library-card", text: "Tab document"
    assert_equal "/documents", URI(page.current_url).path
  end
end
