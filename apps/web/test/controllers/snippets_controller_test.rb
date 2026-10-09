require "test_helper"

class SnippetsControllerTest < ActionDispatch::IntegrationTest
  setup do
    Snippet.delete_all
    @built_in = Snippet.create!(name: "Bold", trigger: "bold", description: "Bold text", category: "Markdown", body: "**${1:text}**", built_in: true)
  end

  test "settings route mounts the shared UI and JSON returns the full editor catalog" do
    get snippets_path

    assert_response :success
    assert_select '[data-controller="client-shell"]'
    assert_select '[data-client-shell-initial-url-value="/snippets"]'
    assert_select '[data-client-shell-snippets-url-value="/snippets.json"]'
    assert_select '[data-client-shell-math-shortcuts-url-value="/math_shortcuts.json"]'

    get snippets_path(format: :json), as: :json
    assert_response :success
    entries = response.parsed_body.fetch("entries")
    assert entries.any? { |entry| entry["id"].to_s == @built_in.id.to_s && entry["built_in"] }
    assert entries.any? { |entry| entry["name"] == "Equation" && entry["category"] == "LaTeX" }
  end

  test "creates a personal snippet through the HTML fallback" do
    assert_difference("Snippet.personal.count") do
      post snippets_path, params: { snippet: { name: "Quote", trigger: "quote", description: "A quote", category: "Markdown", body: "> ${1:quote}" } }
    end

    assert_redirected_to snippets_path
    assert_equal "> ${1:quote}", Snippet.personal.find_by!(trigger: "quote").body
  end

  test "updates and deletes only personal snippets through the HTML fallback" do
    personal = Snippet.create!(name: "Quote", trigger: "quote", description: "A quote", category: "Markdown", body: "> quote")

    patch snippet_path(personal), params: { snippet: { name: "Updated quote" } }
    assert_redirected_to snippets_path
    assert_equal "Updated quote", personal.reload.name

    assert_difference("Snippet.count", -1) { delete snippet_path(personal) }
    assert_response :redirect
  end

  test "cannot edit or delete built-ins" do
    patch snippet_path(@built_in), params: { snippet: { name: "Changed" } }
    assert_response :not_found
    delete snippet_path(@built_in)
    assert_response :not_found
    assert_equal "Bold", @built_in.reload.name
  end

  test "JSON authoring requests create update and delete a personal snippet" do
    post snippets_path(format: :json), params: { snippet: { name: "Quote", trigger: "quote", category: "Markdown", body: "> quote" } }, as: :json
    assert_response :created
    entry = response.parsed_body.fetch("entry")
    assert_equal false, entry.fetch("built_in")

    patch snippet_path(entry.fetch("id"), format: :json), params: { snippet: { name: "Updated quote" } }, as: :json
    assert_response :success
    assert_equal "Updated quote", response.parsed_body.dig("entry", "name")

    delete snippet_path(entry.fetch("id"), format: :json), as: :json
    assert_response :no_content
    assert_nil Snippet.find_by(id: entry.fetch("id"))
  end

  test "JSON validation errors use a typed code without model internals" do
    post snippets_path(format: :json), params: { snippet: { name: "Bad", trigger: "Bad trigger", category: "Markdown", body: "x" } }, as: :json

    assert_response :unprocessable_content
    assert_equal({ "code" => "invalid_input" }, response.parsed_body)
  end
end
