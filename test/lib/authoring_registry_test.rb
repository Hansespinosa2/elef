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
end
