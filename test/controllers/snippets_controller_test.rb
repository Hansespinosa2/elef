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
    assert_select "h3", text: "Equation"
    assert_select "h3", text: "Bold", count: 0
    assert_select "a[href='#{edit_snippet_path(personal)}']"
  end

  test "groups snippets by authoring type and renders latex examples" do
    matrix_body = <<~'LATEX'
      $$
      \begin{bmatrix}
      ${1:a} & ${2:b}\\
      ${3:c} & ${4:d}
      \end{bmatrix}
      $$
    LATEX
    Snippet.create!(
      name: "Matrix",
      trigger: "matrix",
      description: "A two by two matrix",
      category: "LaTeX",
      body: matrix_body,
      built_in: true
    )
    Snippet.create!(name: "Footnote", trigger: "foot", category: "Elef DSL", body: ":::footnote{${1:note}}", built_in: true)

    get snippets_path

    assert_response :success
    assert_select ".snippet-category-link.is-active", text: /All snippets/
    assert_select ".snippet-group-heading", text: /LaTeX/
    assert_select ".snippet-group-heading", text: /Elef directives/
    assert_select ".snippet-example-preview .katex-display", minimum: 1
    assert_select ".snippet-category-badge", text: "Elef directives"
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
