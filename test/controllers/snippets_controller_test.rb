require "test_helper"

class SnippetsControllerTest < ActionDispatch::IntegrationTest
  setup do
    Snippet.delete_all
    @built_in = Snippet.create!(name: "Bold", trigger: "bold", description: "Bold text", category: "Markdown", body: "**${1:text}**", built_in: true)
  end

  test "lists built-ins and searches snippets" do
    personal = Snippet.create!(name: "Equation", trigger: "beq", description: "Block equation", category: "LaTeX", body: "$$${1:x}$$")

    get snippets_path, params: { q: "beq" }

    assert_response :success
    assert_select "h2", text: "Equation"
    assert_select "h2", text: "Bold", count: 0
    assert_select "a[href='#{edit_snippet_path(personal)}']"
  end

  test "creates a personal snippet" do
    assert_difference("Snippet.personal.count") do
      post snippets_path, params: { snippet: { name: "Quote", trigger: "quote", description: "A quote", category: "Markdown", body: "> ${1:quote}" } }
    end

    assert_redirected_to snippets_path
    assert_equal "> ${1:quote}", Snippet.personal.find_by!(trigger: "quote").body
  end

  test "updates and deletes only personal snippets" do
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
end
