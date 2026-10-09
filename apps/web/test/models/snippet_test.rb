require "test_helper"

class SnippetTest < ActiveSupport::TestCase
  test "validates snippet fields and trigger format" do
    snippet = Snippet.new(name: "Example", trigger: "bad trigger", body: "body", category: "Markdown")

    assert_not snippet.valid?
    assert_includes snippet.errors[:trigger], "is invalid"
  end

  test "search matches trigger, name, and description" do
    Snippet.create!(name: "Block equation", trigger: "beq", description: "LaTeX display", category: "LaTeX", body: "$$x$$")
    Snippet.create!(name: "Bold", trigger: "bold", description: "Markdown emphasis", category: "Markdown", body: "**x**")

    assert_equal ["beq"], Snippet.search("latex eq").map(&:trigger)
  end

  test "expands placeholders into text and ordered tab stops" do
    result = Snippets::Catalog.expand("A ${2:second} B ${1:first} C ${0}")

    assert_equal "A second B first C ", result[:text]
    assert_equal [1, 2, 0], result[:stops].map { |stop| stop[:number] }
    assert_equal [[11, 5], [2, 6], [19, 0]], result[:stops].map { |stop| [stop[:start], stop[:length]] }
  end

  test "ships the common Markdown and LaTeX authoring triggers" do
    defaults = Snippets::Catalog::DEFAULTS.index_by { |snippet| snippet[:trigger] }

    assert_equal %w[bga beq bit ben], %w[bga beq bit ben].select { |trigger| defaults.key?(trigger) }
    assert_includes defaults.fetch("bga")[:body], "\\begin{gathered}"
    assert_equal "$$\n${1:equation}\n$$", defaults.fetch("beq")[:body]
    assert_equal "- ${1:first item}\n- ${2:second item}", defaults.fetch("bit")[:body]
    assert_equal "1. ${1:first item}\n2. ${2:second item}", defaults.fetch("ben")[:body]
    assert_equal "\\frac{${1:numerator}}{${2:denominator}}", defaults.fetch("frac")[:body]
    assert_includes Snippets::Catalog.for_editor.map { |snippet| snippet[:trigger] }, "bga"
  end
end
