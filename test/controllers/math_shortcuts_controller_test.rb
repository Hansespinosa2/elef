require "test_helper"

class MathShortcutsControllerTest < ActionDispatch::IntegrationTest
  test "lists built-in catalog entries before seeds are loaded" do
    get math_shortcuts_path

    assert_response :success
    assert_select ".math-shortcut-card", minimum: 10
    assert_select ".math-shortcut-card", text: /Alpha/
    assert_select ".math-shortcut-card", text: /x\.bar/
    assert_select ".math-shortcut-step code", text: "\\bar{x}"
    assert_select ".math-shortcut-flow .math-shortcut-result .katex", minimum: 1
  end

  test "creates updates and deletes a personal math shortcut" do
    post math_shortcuts_path, params: { math_shortcut: { name: "Bold symbol", aliases: "b, bold", prefix: ".", description: "Bold", expansion: "\\\\mathbf{${1}}" } }
    assert_redirected_to math_shortcuts_path

    shortcut = MathShortcut.personal.order(:id).last
    assert_equal %w[b bold], shortcut.aliases

    patch math_shortcut_path(shortcut), params: { math_shortcut: { name: "Strong symbol" } }
    assert_redirected_to math_shortcuts_path
    assert_equal "Strong symbol", shortcut.reload.name

    assert_difference("MathShortcut.count", -1) { delete math_shortcut_path(shortcut) }
  end

  test "built-in math shortcuts cannot be edited or removed" do
    shortcut = MathShortcut.create!(name: "Built in", aliases: ["bi"], prefix: "@", expansion: "\\\\beta", built_in: true)

    patch math_shortcut_path(shortcut), params: { math_shortcut: { name: "Changed" } }
    assert_redirected_to math_shortcuts_path
    assert_equal "Built in", shortcut.reload.name

    assert_no_difference("MathShortcut.count") { delete math_shortcut_path(shortcut) }
    assert_equal "Built in", shortcut.reload.name
  end
end
