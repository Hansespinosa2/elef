require "test_helper"

class PresentationsControllerTest < ActionDispatch::IntegrationTest
  test "library loads" do
    get presentations_path
    assert_response :success
    assert_select "h1", "Presentation library"
  end

  test "creates a presentation from markdown source" do
    assert_difference("Presentation.count", 1) do
      post presentations_path, params: { presentation: { title: "Request Deck", source: "# One\n---\n# Two" } }
    end

    presentation = Presentation.order(:created_at).last
    assert_redirected_to edit_presentation_path(presentation)
    assert_equal "# One\n---\n# Two", presentation.source
  end

  test "updates source only on explicit save request" do
    presentation = presentations(:one)

    patch presentation_path(presentation), params: { presentation: { title: "Updated", source: "# Saved\n---\n# Again" } }

    assert_redirected_to edit_presentation_path(presentation)
    assert_equal "# Saved\n---\n# Again", presentation.reload.source
  end

  test "renders saved preview and presentation mode" do
    presentation = presentations(:one)

    get presentation_path(presentation)
    assert_response :success
    assert_select ".slide", 2
    assert_select "h1", text: "One"

    get present_presentation_path(presentation)
    assert_response :success
    assert_select ".presentation-slide", 2
  end
end
