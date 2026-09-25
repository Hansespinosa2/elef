require "test_helper"

class WorkspaceTest < ActiveSupport::TestCase
  test "default returns or creates the system default workspace idempotently" do
    default1 = Workspace.default
    assert default1.persisted?
    assert_equal "default", default1.slug
    assert default1.system?

    default2 = Workspace.default
    assert_equal default1.id, default2.id
  end

  test "theme and typography fall back to defaults when settings are empty or invalid" do
    workspace = Workspace.new(name: "Test", slug: "test-#{SecureRandom.hex(4)}")
    assert_equal Workspace::DEFAULT_THEME, workspace.default_theme
    assert_equal Workspace::DEFAULT_TYPOGRAPHY, workspace.default_typography

    workspace.settings = { "theme" => "nonexistent", "typography" => "fake" }
    assert_equal Workspace::DEFAULT_THEME, workspace.default_theme
    assert_equal Workspace::DEFAULT_TYPOGRAPHY, workspace.default_typography

    workspace.settings = { "theme" => "dark", "typography" => "modern" }
    assert_equal "dark", workspace.default_theme
    assert_equal "modern", workspace.default_typography
  end

  test "update_style_defaults persists validated style choices" do
    workspace = Workspace.create!(name: "Styling", slug: "style-#{SecureRandom.hex(4)}")
    workspace.update_style_defaults(theme: "dark", typography: "technical")

    assert_equal "dark", workspace.reload.default_theme
    assert_equal "technical", workspace.default_typography
    assert_equal "dark", workspace.theme
    assert_equal "technical", workspace.typography

    workspace.update_style_defaults(theme: "invalid", typography: "invalid")
    assert_equal Workspace::DEFAULT_THEME, workspace.reload.default_theme
    assert_equal Workspace::DEFAULT_TYPOGRAPHY, workspace.default_typography
  end

  test "validates presence of name and slug and uniqueness of slug" do
    invalid = Workspace.new(name: nil, slug: nil)
    refute invalid.valid?
    assert_includes invalid.errors[:name], "can't be blank"
    assert_includes invalid.errors[:slug], "can't be blank"

    Workspace.create!(name: "First", slug: "unique-slug-test")
    duplicate = Workspace.new(name: "Second", slug: "unique-slug-test")
    refute duplicate.valid?
    assert_includes duplicate.errors[:slug], "has already been taken"
  end

  test "settings getter handles corrupted json string gracefully" do
    workspace = Workspace.new(name: "Corrupt", slug: "corrupt-#{SecureRandom.hex(4)}")
    workspace[:settings] = "{not valid json"
    assert_equal({}, workspace.settings)
  end
end
