require "test_helper"

class StyleAndMathShortcutTest < ActiveSupport::TestCase
  test "resolves generic style overrides through workspace defaults and can clear them" do
    workspace = Workspace.create!(name: "Style workspace", slug: "style-#{SecureRandom.hex(5)}", settings: { "theme" => "dark", "typography" => "modern" })
    document = Document.create!(workspace: workspace, title: "Style notes", source: "# Notes")

    assert_equal "dark", document.theme
    assert_equal "modern", document.typography

    document.theme = "light"
    document.typography = "technical"
    document.save!
    assert_equal ["light", "technical"], [document.reload.theme, document.typography]

    document.theme = nil
    document.typography = nil
    document.save!
    assert_equal ["dark", "modern"], [document.reload.theme, document.typography]
    refute_includes document.source, "theme:"
    refute_includes document.source, "typography:"
    assert_equal "# Notes", document.source
  end

  test "invalid generic style values fall back to workspace defaults" do
    workspace = Workspace.create!(name: "Invalid style workspace", slug: "invalid-style-#{SecureRandom.hex(5)}", settings: { "theme" => "dark", "typography" => "technical" })
    document = Document.create!(workspace: workspace, title: "Invalid style", source: "---\ntheme: ultraviolet\ntypography: ornate\n---\n# Notes")

    assert_equal ["dark", "technical"], [document.theme, document.typography]
  end

  test "math shortcuts normalize aliases and expose built-in editor data" do
    shortcut = MathShortcut.create!(name: "Bold", aliases: "b, bold", prefix: ".", expansion: "\\\\mathbf{${1}}")

    assert_equal %w[b bold], shortcut.reload.aliases
    assert_includes MathShortcuts::Catalog.for_editor, { id: shortcut.id, name: "Bold", aliases: %w[b bold], description: "", prefix: ".", expansion: "\\\\mathbf{${1}}", built_in: false }
    assert MathShortcuts::Catalog.for_editor.any? { |item| item[:aliases].include?("alpha") }
    assert_equal "\\mathbf{${1}}", MathShortcuts::Catalog::DEFAULTS.find { |item| item[:name] == "Bold" }[:expansion]
  end
end
