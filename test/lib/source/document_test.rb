require "test_helper"

class SourceDocumentTest < ActiveSupport::TestCase
  test "theme_from_source defaults to match without front matter" do
    assert_equal "match", Source::Document.theme_from_source("# Title")
    assert_equal "match", Source::Document.theme_from_source("")
  end

  test "typography_from_source defaults to book without front matter" do
    assert_equal "book", Source::Document.typography_from_source("# Title")
    assert_equal "book", Source::Document.typography_from_source("")
  end

  test "theme_from_source defaults to match when the key is absent" do
    assert_equal "match", Source::Document.theme_from_source("---\ntypography: dark\n---\n# Title")
  end

  test "typography_from_source defaults to book when the key is absent" do
    assert_equal "book", Source::Document.typography_from_source("---\ntheme: dark\n---\n# Title")
  end

  test "theme_from_source strips matching single and double quotes" do
    assert_equal "dark", Source::Document.theme_from_source("---\ntheme: \"dark\"\n---\n# Title")
    assert_equal "light", Source::Document.theme_from_source("---\ntheme: 'light'\n---\n# Title")
    assert_equal "match", Source::Document.theme_from_source("---\ntheme: \"dark\n---\n# Title")
  end

  test "typography_from_source strips matching single and double quotes" do
    assert_equal "modern", Source::Document.typography_from_source("---\ntypography: \"modern\"\n---\n# Title")
    assert_equal "technical", Source::Document.typography_from_source("---\ntypography: 'technical'\n---\n# Title")
    assert_equal "book", Source::Document.typography_from_source("---\ntypography: \"modern\n---\n# Title")
  end

  test "theme_from_source strips a trailing comment introduced by whitespace" do
    assert_equal "dark", Source::Document.theme_from_source("---\ntheme: dark # deck theme\n---\n# Title")
    assert_equal "dark", Source::Document.theme_from_source("---\ntheme: \"dark\" # deck theme\n---\n# Title")
    assert_equal "dark", Source::Document.theme_from_source("---\ntheme:   dark   \t# deck theme\n---\n# Title")
  end

  test "typography_from_source strips a trailing comment introduced by whitespace" do
    assert_equal "modern", Source::Document.typography_from_source("---\ntypography: modern # body text\n---\n# Title")
    assert_equal "modern", Source::Document.typography_from_source("---\ntypography: 'modern' # body text\n---\n# Title")
    assert_equal "modern", Source::Document.typography_from_source("---\ntypography:   modern   \t# body text\n---\n# Title")
  end

  test "style front matter keeps a hash that has no preceding whitespace" do
    assert_equal "match", Source::Document.theme_from_source("---\ntheme: light#x\n---\n# Title")
    assert_equal "match", Source::Document.theme_from_source("---\ntheme: dark#x\n---\n# Title")
    assert_equal "book", Source::Document.typography_from_source("---\ntypography: modern#x\n---\n# Title")
    assert_equal "book", Source::Document.typography_from_source("---\ntypography: book#x\n---\n# Title")
  end

  test "theme_from_source falls back to match outside the theme vocabulary" do
    assert_equal "match", Source::Document.theme_from_source("---\ntheme: unknown\n---\n# Title")
    assert_equal "match", Source::Document.theme_from_source("---\ntheme: book\n---\n# Title")
    assert_equal "match", Source::Document.theme_from_source("---\ntheme: modern\n---\n# Title")
    assert_equal "match", Source::Document.theme_from_source("---\ntheme: technical\n---\n# Title")
    assert_equal "match", Source::Document.theme_from_source("---\ntheme:\n---\n# Title")
    assert_equal "match", Source::Document.theme_from_source("---\ntheme: \"\"\n---\n# Title")
  end

  test "typography_from_source falls back to book outside the typography vocabulary" do
    assert_equal "book", Source::Document.typography_from_source("---\ntypography: unknown\n---\n# Title")
    assert_equal "book", Source::Document.typography_from_source("---\ntypography: light\n---\n# Title")
    assert_equal "book", Source::Document.typography_from_source("---\ntypography: dark\n---\n# Title")
    assert_equal "book", Source::Document.typography_from_source("---\ntypography: match\n---\n# Title")
    assert_equal "book", Source::Document.typography_from_source("---\ntypography:\n---\n# Title")
    assert_equal "book", Source::Document.typography_from_source("---\ntypography: \"\"\n---\n# Title")
  end

  test "theme_from_source keeps the earliest theme key" do
    assert_equal "dark", Source::Document.theme_from_source("---\ntheme: dark\ntheme: light\n---\n# Title")
    assert_equal "light", Source::Document.theme_from_source("---\ntheme: light\ntheme: dark\n---\n# Title")
    assert_equal "match", Source::Document.theme_from_source("---\ntheme: unknown\ntheme: dark\n---\n# Title")
  end

  test "typography_from_source keeps the earliest typography key" do
    assert_equal "book", Source::Document.typography_from_source("---\ntypography: book\ntypography: modern\n---\n# Title")
    assert_equal "modern", Source::Document.typography_from_source("---\ntypography: modern\ntypography: book\n---\n# Title")
    assert_equal "book", Source::Document.typography_from_source("---\ntypography: unknown\ntypography: modern\n---\n# Title")
  end

  test "style keys only match the start of a front matter line" do
    source = "---\ntitle: theme: dark\n---\n# Title"
    assert_equal "match", Source::Document.theme_from_source(source)

    source = "---\ntitle: typography: modern\n---\n# Title"
    assert_equal "book", Source::Document.typography_from_source(source)
  end

  test "style keys outside front matter are ignored" do
    assert_equal "match", Source::Document.theme_from_source("# Title\n\ntheme: dark\n")
    assert_equal "book", Source::Document.typography_from_source("# Title\n\ntypography: modern\n")
  end

  test "style front matter is read before the closing delimiter only" do
    assert_equal "match", Source::Document.theme_from_source("---\ntitle: A\n---\ntheme: dark\n")
    assert_equal "book", Source::Document.typography_from_source("---\ntitle: A\n---\ntypography: modern\n")
  end

  test "style front matter tolerates CRLF line endings" do
    assert_equal "dark", Source::Document.theme_from_source("---\r\ntheme: dark\r\n---\r\n# Title")
    assert_equal "modern", Source::Document.typography_from_source("---\r\ntypography: modern\r\n---\r\n# Title")
  end

  test "style front matter tolerates a byte order mark before the delimiter" do
    assert_equal "dark", Source::Document.theme_from_source("\uFEFF---\ntheme: dark\n---\n# Title")
    assert_equal "modern", Source::Document.typography_from_source("\uFEFF---\ntypography: modern\n---\n# Title")
  end

  test "portable document keys and aliases round-trip in front matter without changing the body" do
    source = "---\r\ntheme: dark\r\n---\r\n# Title\r\n\r\nNotes stay byte-identical.\r\n"
    updated = Source::Document.with_portable_document_link_metadata(
      source,
      document_key: "portable-key",
      aliases: ["Old title", "Café", "Old title"]
    )

    assert_equal({ document_key: "portable-key", aliases: ["Old title", "Café"] },
      Source::Document.portable_document_link_metadata(updated))
    assert_includes updated, "elef_document_key: \"portable-key\"\r\n"
    assert_includes updated, "elef_aliases: [\"Old title\",\"Café\"]\r\n"
    assert updated.end_with?("# Title\r\n\r\nNotes stay byte-identical.\r\n")
  end

  test "malformed portable document metadata is ignored safely" do
    source = "---\nelef_document_key: [invalid\nelef_aliases: nope\n---\n# Notes"

    assert_equal({ document_key: nil, aliases: [] }, Source::Document.portable_document_link_metadata(source))
  end
end
