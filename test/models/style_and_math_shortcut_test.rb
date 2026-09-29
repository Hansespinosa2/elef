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
    symbol_shortcut = MathShortcut.create!(name: "Equivalent test shortcut", aliases: "=", prefix: "@", expansion: "\\equiv")

    assert_equal %w[b bold], shortcut.reload.aliases
    assert_equal ["="], symbol_shortcut.reload.aliases
    refute MathShortcut.new(name: "Dollar", aliases: ["$"], prefix: "@", expansion: "\\$").valid?
    refute MathShortcut.new(name: "Comma", aliases: [","], prefix: "@", expansion: ",").valid?
    assert_includes MathShortcuts::Catalog.for_editor, { id: shortcut.id, name: "Bold", aliases: %w[b bold], description: "", prefix: ".", expansion: "\\\\mathbf{${1}}", built_in: false }
    assert MathShortcuts::Catalog.for_editor.any? { |item| item[:aliases].include?("alpha") }
    assert_equal "\\mathbf{${1}}", MathShortcuts::Catalog::DEFAULTS.find { |item| item[:name] == "Bold" }[:expansion]
    refute_includes MathShortcuts::Catalog::DEFAULTS.find { |item| item[:name] == "Bold" }[:aliases], "bb"
    assert_includes MathShortcuts::Catalog::DEFAULTS.find { |item| item[:name] == "Blackboard bold" }[:aliases], "bb"
  end

  test "includes uppercase and lowercase Greek letter shortcuts" do
    catalog = MathShortcuts::Catalog.for_editor
    lowercase_greek = {
      "a" => "\\alpha", "b" => "\\beta", "c" => "\\chi", "d" => "\\delta",
      "e" => "\\epsilon", "f" => "\\phi", "g" => "\\gamma", "h" => "\\eta",
      "i" => "\\iota", "k" => "\\kappa", "l" => "\\lambda", "m" => "\\mu",
      "n" => "\\nu", "o" => "\\omega", "p" => "\\pi", "q" => "\\theta",
      "r" => "\\rho", "s" => "\\sigma", "t" => "\\tau", "u" => "\\upsilon",
      "w" => "\\omega", "x" => "\\xi", "y" => "\\psi", "z" => "\\zeta"
    }
    uppercase_greek = {
      "D" => "\\Delta", "F" => "\\Phi", "G" => "\\Gamma", "L" => "\\Lambda",
      "P" => "\\Pi", "Q" => "\\Theta", "S" => "\\Sigma", "U" => "\\Upsilon",
      "W" => "\\Omega", "X" => "\\Xi", "Y" => "\\Psi"
    }

    expected_aliases = lowercase_greek.keys + uppercase_greek.keys
    actual_aliases = catalog.flat_map do |item|
      item[:prefix] == "@" ? item[:aliases].select { |alias_name| alias_name.match?(/\A[A-Za-z]\z/) } : []
    end
    assert_equal expected_aliases.sort, actual_aliases.sort, "single-letter @ aliases should only name supported Greek shortcuts"

    lowercase_greek.merge(uppercase_greek).each do |letter, expansion|
      shortcut = catalog.find { |item| item[:prefix] == "@" && item[:aliases].include?(letter) }
      assert_equal expansion, shortcut&.fetch(:expansion), "@#{letter} should expand to #{expansion}"

      html = Source::Renderer.render("$#{expansion}$")
      assert_includes html, 'class="katex"', "@#{letter} should render through KaTeX"
      refute_includes html, 'class="math-error"', "@#{letter} should not produce a math error"
    end

    %w[ve vf vs vq vp vr].each do |alias_name|
      shortcut = catalog.find { |item| item[:prefix] == "@" && item[:aliases].include?(alias_name) }
      html = Source::Renderer.render("$#{shortcut[:expansion]}$")
      assert_includes html, 'class="katex"', "@#{alias_name} should render through KaTeX"
      refute_includes html, 'class="math-error"', "@#{alias_name} should not produce a math error"
    end
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
    assert_equal "\\infty", catalog.find { |item| item[:prefix] == "@" && item[:aliases].include?("8") }[:expansion]
    assert_equal "\\partial", catalog.find { |item| item[:prefix] == "@" && item[:aliases].include?("6") }[:expansion]
    assert_equal "^\\circ", catalog.find { |item| item[:prefix] == "@" && item[:aliases].include?("0") }[:expansion]
    assert_equal "\\equiv", catalog.find { |item| item[:prefix] == "@" && item[:aliases].include?("=") }[:expansion]

    assert_equal(
      { text: "\\frac{}{}", stops: [{ number: 1, start: 6, length: 0 }, { number: 2, start: 8, length: 0 }] },
      MathShortcuts::Catalog.expand("\\frac{${1}}{${2}}")
    )
    assert_equal(
      { text: "\\mathbf{q}", stops: [{ number: 1, start: 8, length: 1 }] },
      MathShortcuts::Catalog.expand("\\mathbf{${1}}", value: "q")
    )
  end

  test "ignores stale built-in shortcuts and preserves unshadowed default aliases" do
    workspace = Workspace.create!(name: "Legacy math shortcuts", slug: "legacy-math-#{SecureRandom.hex(5)}")
    MathShortcut.create!(workspace: workspace, name: "Capital Beta", aliases: ["B", "Beta"], prefix: "@", expansion: "B", built_in: true)
    MathShortcut.create!(workspace: workspace, name: "Custom beta", aliases: ["beta"], prefix: "@", expansion: "\\operatorname{custombeta}")
    MathShortcut.create!(workspace: workspace, name: "Capital Theta", aliases: ["Q", "Theta"], prefix: "@", expansion: "\\Theta", built_in: true)

    catalog = MathShortcuts::Catalog.for_editor(workspace: workspace)
    beta = catalog.find { |item| item[:id] == "default-beta" }
    theta = catalog.find { |item| item[:id] == "default-theta" }
    capital_theta = catalog.find { |item| item[:name] == "Capital Theta" }

    refute catalog.any? { |item| item[:name] == "Capital Beta" }, "removed built-in shortcuts should not survive from old seed data"
    assert_equal ["b"], beta[:aliases], "a custom @beta mapping should not remove the @b default"
    assert_equal "\\beta", beta[:expansion]
    assert_equal ["q", "th", "theta"], theta[:aliases]
    assert_equal %w[Q Theta], capital_theta[:aliases], "current built-ins should use case-sensitive default aliases"
  end

  test "personal aliases shadow persisted built-ins in the editor and settings catalog" do
    workspace = Workspace.create!(name: "Persisted math shortcuts", slug: "persisted-math-#{SecureRandom.hex(5)}")
    persisted_beta = MathShortcut.create!(workspace: workspace, name: "Beta", aliases: ["legacybeta"], prefix: "@", expansion: "\\operatorname{oldbeta}", built_in: true)
    personal_beta = MathShortcut.create!(workspace: workspace, name: "Custom beta", aliases: ["beta"], prefix: "@", expansion: "\\operatorname{custombeta}")

    editor_beta = MathShortcuts::Catalog.for_editor(workspace: workspace).find { |item| item[:id] == persisted_beta.id }
    assert_equal ["b"], editor_beta[:aliases]
    assert_equal "\\beta", editor_beta[:expansion]

    settings = MathShortcuts::Catalog.for_ui(workspace: workspace)
    settings_beta = settings.find { |item| item.name == "Beta" }
    settings_personal = settings.find { |item| item.id == personal_beta.id }
    assert_equal ["b"], settings_beta.aliases
    assert_equal "\\beta", settings_beta.expansion
    assert settings_beta.built_in?
    assert settings_personal.persisted?, "personal shortcuts should remain editable persisted records"
  end
end
