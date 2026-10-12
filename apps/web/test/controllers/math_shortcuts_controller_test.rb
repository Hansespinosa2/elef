require "test_helper"

class MathShortcutsControllerTest < ActionDispatch::IntegrationTest
  test "settings route mounts the shared UI and JSON returns the full editor catalog" do
    get math_shortcuts_path

    assert_response :success
    assert_select '[data-controller="client-shell"]'
    assert_select '[data-client-shell-initial-url-value="/math_shortcuts"]'
    assert_select '[data-client-shell-snippets-url-value="/snippets.json"]'
    assert_select '[data-client-shell-math-shortcuts-url-value="/math_shortcuts.json"]'

    get math_shortcuts_path(format: :json), as: :json
    assert_response :success
    entries = response.parsed_body.fetch("entries")
    assert entries.any? { |entry| entry["name"] == "Equation" && entry["built_in"] }
  end

  test "JSON authoring requests create update and delete a personal math shortcut" do
    post math_shortcuts_path(format: :json), params: {
      math_shortcut: { name: "Bold symbol", aliases: %w[b bold], prefix: ".", description: "Bold", expansion: "\\\\mathbf{${1}}" }
    }, as: :json
    assert_response :created
    entry = response.parsed_body.fetch("entry")
    assert_equal %w[b bold], entry.fetch("aliases")
    assert_equal false, entry.fetch("built_in")

    patch math_shortcut_path(entry.fetch("id"), format: :json), params: {
      math_shortcut: { name: "Strong symbol", aliases: %w[strong s] }
    }, as: :json
    assert_response :success
    assert_equal "Strong symbol", response.parsed_body.dig("entry", "name")
    assert_equal %w[strong s], response.parsed_body.dig("entry", "aliases")

    delete math_shortcut_path(entry.fetch("id"), format: :json), as: :json
    assert_response :no_content
    assert_nil MathShortcut.find_by(id: entry.fetch("id"))
  end

  test "math shortcut JSON accepts legacy comma-separated aliases and reports invalid input safely" do
    post math_shortcuts_path(format: :json), params: {
      math_shortcut: { name: "Bold symbol", aliases: "b, bold", prefix: ".", expansion: "\\\\mathbf{${1}}" }
    }, as: :json
    assert_response :created
    assert_equal %w[b bold], response.parsed_body.dig("entry", "aliases")

    post math_shortcuts_path(format: :json), params: {
      math_shortcut: { name: "Bad symbol", aliases: ["$"], prefix: "@", expansion: "\\$" }
    }, as: :json
    assert_response :unprocessable_content
    assert_equal({ "code" => "invalid_input" }, response.parsed_body)
  end

  test "built-in math shortcuts cannot be edited or removed through JSON" do
    shortcut = MathShortcut.create!(name: "Built in", aliases: ["bi"], prefix: "@", expansion: "\\\\beta", built_in: true)

    patch math_shortcut_path(shortcut, format: :json), params: { math_shortcut: { name: "Changed" } }, as: :json
    assert_response :forbidden
    assert_equal({ "code" => "unsupported" }, response.parsed_body)
    assert_equal "Built in", shortcut.reload.name

    delete math_shortcut_path(shortcut, format: :json), as: :json
    assert_response :forbidden
    assert_equal "Built in", shortcut.reload.name
  end
end
