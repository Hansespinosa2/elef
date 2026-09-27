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
    assert_includes MathShortcuts::Catalog::DEFAULTS.find { |item| item[:name] == "Bold" }[:aliases], "bb"
    refute_includes MathShortcuts::Catalog::DEFAULTS.find { |item| item[:name] == "Blackboard bold" }[:aliases], "bb"
  end

  test "includes uppercase and lowercase Greek letter shortcuts" do
    catalog = MathShortcuts::Catalog.for_editor
    greek = {
      "A" => "\\Alpha", "B" => "\\Beta", "G" => "\\Gamma", "D" => "\\Delta",
      "E" => "\\Epsilon", "Z" => "\\Zeta", "H" => "\\Eta", "Q" => "\\Theta",
      "I" => "\\Iota", "K" => "\\Kappa", "L" => "\\Lambda", "M" => "\\Mu",
      "N" => "\\Nu", "X" => "\\Xi", "O" => "\\Omicron", "P" => "\\Pi",
      "R" => "\\Rho", "S" => "\\Sigma", "T" => "\\Tau", "U" => "\\Upsilon",
      "F" => "\\Phi", "C" => "\\Chi", "Y" => "\\Psi", "W" => "\\Omega"
    }

    greek.each do |letter, expansion|
      shortcut = catalog.find { |item| item[:prefix] == "@" && item[:aliases].include?(letter) }
      assert_equal expansion, shortcut&.fetch(:expansion), "@#{letter} should expand to #{expansion}"
    end

    assert_equal "\\alpha", catalog.find { |item| item[:prefix] == "@" && item[:aliases].include?("a") }[:expansion]
    assert_equal "\\omega", catalog.find { |item| item[:prefix] == "@" && item[:aliases].include?("w") }[:expansion]
    assert_equal "\\omicron", catalog.find { |item| item[:prefix] == "@" && item[:aliases].include?("omicron") }[:expansion]
  end

  test "includes common TeX operators and expands multiple math slots in order" do
    catalog = MathShortcuts::Catalog.for_editor

    assert_equal "\\nabla", catalog.find { |item| item[:aliases].include?("nabla") }[:expansion]
    assert_equal "\\to", catalog.find { |item| item[:aliases].include?("to") }[:expansion]
    assert_equal "\\bar{${1}}", catalog.find { |item| item[:aliases].include?("bar") }[:expansion]
    assert_equal "\\longrightarrow", catalog.find { |item| item[:aliases].include?("longright") }[:expansion]
    refute_includes catalog.find { |item| item[:name] == "Implies" }[:aliases], "longrightarrow"
    assert_equal "\\inf", catalog.find { |item| item[:aliases].include?("inf") }[:expansion]
    assert_equal "\\sum", catalog.find { |item| item[:aliases].include?("sum") }[:expansion]

    assert_equal(
      { text: "\\frac{}{}", stops: [{ number: 1, start: 6, length: 0 }, { number: 2, start: 8, length: 0 }] },
      MathShortcuts::Catalog.expand("\\frac{${1}}{${2}}")
    )
    assert_equal(
      { text: "\\mathbf{q}", stops: [{ number: 1, start: 8, length: 1 }] },
      MathShortcuts::Catalog.expand("\\mathbf{${1}}", value: "q")
    )
  end
end
