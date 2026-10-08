require "test_helper"

class AuthoringRegistryTest < ActiveSupport::TestCase
  test "the checked-in editor registry matches the canonical built-in entries" do
    artifact = Rails.root.join("app/javascript/data/default_authoring_registry.json")
    checked_in = JSON.parse(File.read(artifact))
    generated = JSON.parse(AuthoringRegistry.built_in_entries.to_json)

    assert_equal generated, checked_in
    assert checked_in.any? { |entry| entry["namespace"] == "/" && entry["trigger"] == "bold" }
    assert checked_in.any? { |entry| entry["namespace"] == "@" && entry["aliases"].include?("alpha") }
  end

  test "exposes canonical directive names with compatibility aliases and schemas" do
    registry = AuthoringRegistry.for_editor(workspace: Workspace.default)

    section = registry.find { |entry| entry[:namespace] == ":" && entry[:trigger] == "section" }
    subsection = registry.find { |entry| entry[:namespace] == ":" && entry[:trigger] == "subsection" }
    footnote = registry.find { |entry| entry[:namespace] == ":" && entry[:trigger] == "footnote" }
    align = registry.find { |entry| entry[:namespace] == ":" && entry[:trigger] == "align" }
    art = registry.find { |entry| entry[:namespace] == ":" && entry[:trigger] == "art" }
    diagram = registry.find { |entry| entry[:namespace] == "/" && entry[:trigger] == "diagram" }

    assert_equal ["sse"], section[:aliases]
    assert_equal ["sss"], subsection[:aliases]
    assert_equal ["foot"], footnote[:aliases]
    assert_equal ["text"], section.dig(:argument_schema, :grammar)
    assert_equal 1, footnote.dig(:argument_schema, :argument_count)
    assert_equal ["top", "middle", "bottom"], align.dig(:argument_schema, :values, 1)
    assert_equal ":::art", art.dig(:behavior, :template)
    assert_equal 0, art.dig(:argument_schema, :argument_count)
    assert_equal "mermaid_assist", diagram.dig(:behavior, :type)
  end

  test "restricts raw LaTeX snippets to math and keeps delimited equations in source" do
    registry = AuthoringRegistry.for_editor(workspace: Workspace.default)

    fraction = registry.find { |entry| entry[:namespace] == "/" && entry[:trigger] == "frac" }
    equation = registry.find { |entry| entry[:namespace] == "/" && entry[:trigger] == "equation" }
    inline_equation = registry.find { |entry| entry[:namespace] == "/" && entry[:trigger] == "ieq" }

    assert_equal ["math"], fraction[:contexts]
    assert_equal ["source"], equation[:contexts]
    assert_equal ["source"], inline_equation[:contexts]
  end

  test "registers local hat and tilde transforms as decorations" do
    registry = AuthoringRegistry.for_editor(workspace: Workspace.default)
    hat = registry.find { |entry| entry[:namespace] == "." && entry[:trigger] == "hat" }
    tilde = registry.find { |entry| entry[:namespace] == "." && entry[:trigger] == "tilde" }

    assert_equal "\\hat{${1}}", hat.dig(:behavior, :template)
    assert_equal "decoration", hat.dig(:behavior, :operator_class)
    assert_equal "\\tilde{${1}}", tilde.dig(:behavior, :template)
    assert_equal "decoration", tilde.dig(:behavior, :operator_class)
  end

  test "registers calligraphic and roman transforms as style" do
    registry = AuthoringRegistry.for_editor(workspace: Workspace.default)
    cal = registry.find { |entry| entry[:namespace] == "." && entry[:trigger] == "cal" }
    rm = registry.find { |entry| entry[:namespace] == "." && entry[:trigger] == "rm" }

    assert_equal "\\mathcal{${1}}", cal.dig(:behavior, :template)
    assert_equal "style", cal.dig(:behavior, :operator_class)
    assert_equal "\\mathrm{${1}}", rm.dig(:behavior, :template)
    assert_equal "style", rm.dig(:behavior, :operator_class)
  end
end
