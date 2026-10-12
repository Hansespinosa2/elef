require "test_helper"

class BugReports::IssueRendererTest < ActiveSupport::TestCase
  test "renders expected and actual behavior with multiline Markdown-safe formatting" do
    body = renderer.body(
      expected: "Click *Save*\nthen wait < 5 seconds",
      actual: "The page stays open\n# Internal detail",
      steps: "1. Click [Save](javascript:example)\n2. Press Enter",
      environment: "Elef build: test-build; Rails: 8.1; Browser: Firefox 140; OS: Linux"
    )

    assert_includes body, "**Expected:** Click \\*Save\\*<br>\nthen wait &lt; 5 seconds"
    assert_includes body, "**Actual:** The page stays open<br>\n\\# Internal detail"
    assert_includes body, "**Steps to reproduce:**\n\n1. Click \\[Save\\]\\(javascript:example\\)\n2. Press Enter"
    assert_includes body, "**Environment:** Elef build: test\\-build; Rails: 8\\.1; Browser: Firefox 140; OS: Linux"
    assert_includes body, "---\n\nFix this bug, ensure it passes all tests (skip only checks failing due to CI rate/API limits),"
  end

  test "numbers one step per line and drops empty lines or existing numbering" do
    body = renderer.body(expected: "A", actual: "B", steps: "\n1. First step\n2) Second step\n", environment: "test")

    assert_includes body, "1. First step\n2. Second step"
    refute_includes body, "3."
  end

  test "normalizes CRLF reproduction steps before numbering them" do
    body = renderer.body(expected: "A", actual: "B", steps: "1. First step\r\n2) Second step\r\n", environment: "test")

    assert_includes body, "1. First step\n2. Second step"
    refute_includes body, "\r"
  end

  test "uses the first meaningful actual line and caps the deterministic title" do
    assert_equal "Bug: Save does not finish", renderer.title_for(actual: "\n  Save does not finish  \nMore detail")

    title = renderer.title_for(actual: "x" * 150)
    assert_equal 100, title.length
    assert title.start_with?("Bug: ")
    assert title.end_with?("…")
    assert_equal "Bug report", renderer.title_for(actual: "  \n ")
  end

  private

  def renderer
    @renderer ||= BugReports::IssueRenderer.new
  end
end
