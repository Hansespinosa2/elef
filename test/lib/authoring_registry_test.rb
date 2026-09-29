require "test_helper"

class AuthoringRegistryTest < ActiveSupport::TestCase
  test "exposes canonical directive names with compatibility aliases and schemas" do
    registry = AuthoringRegistry.for_editor(workspace: Workspace.default)

    section = registry.find { |entry| entry[:namespace] == ":" && entry[:trigger] == "section" }
    subsection = registry.find { |entry| entry[:namespace] == ":" && entry[:trigger] == "subsection" }
    footnote = registry.find { |entry| entry[:namespace] == ":" && entry[:trigger] == "footnote" }
    align = registry.find { |entry| entry[:namespace] == ":" && entry[:trigger] == "align" }

    assert_equal ["sse"], section[:aliases]
    assert_equal ["sss"], subsection[:aliases]
    assert_equal ["foot"], footnote[:aliases]
    assert_equal ["text"], section.dig(:argument_schema, :grammar)
    assert_equal 1, footnote.dig(:argument_schema, :argument_count)
    assert_equal ["top", "middle", "bottom"], align.dig(:argument_schema, :values, 1)
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
end
