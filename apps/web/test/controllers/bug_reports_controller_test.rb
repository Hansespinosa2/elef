require "test_helper"

class BugReportsControllerTest < ActionDispatch::IntegrationTest
  FakeResult = Data.define(:success?, :url, :error)

  class FakeIssueCreator
    attr_reader :arguments, :call_count

    def initialize(result: FakeResult.new(true, "https://github.com/acme/elef/issues/27", nil))
      @result = result
      @call_count = 0
    end

    def call(**arguments)
      @call_count += 1
      @arguments = arguments
      @result
    end
  end

  setup do
    BugReportsController::RATE_LIMIT_STORE.clear
  end

  test "application layout exposes the report dialog and keeps server credentials out of client markup" do
    previous_token = ENV["GITHUB_TOKEN"]
    ENV["GITHUB_TOKEN"] = "server-only-token"

    get root_path

    assert_response :success
    assert_select 'button[data-action="bug-report#open"][data-bug-report-ignore]', text: "Report Bug"
    assert_select '#bug-report-recording-disclosure', text: /typed text.*automatically kept in memory for up to 60 seconds.*If submitted, these may be included.*review and edit the generated steps/i
    assert_select 'button[aria-describedby="bug-report-recording-disclosure"]'
    assert_select 'dialog#bug-report-dialog'
    assert_select 'textarea[name="expected"][required]'
    assert_select 'textarea[name="actual"][required]'
    assert_select 'textarea[name="steps"][required]'
    refute_includes response.body, "server-only-token"
  ensure
    ENV["GITHUB_TOKEN"] = previous_token
  end

  test "submits deterministic issue content and returns the created issue URL" do
    creator = FakeIssueCreator.new
    with_issue_creator(creator) do
      post bug_reports_path,
        params: { bug_report: { expected: "The page closes", actual: "The page remains open", steps: "1. Click Edit\n2. Press Enter" } },
        headers: { "User-Agent" => "Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0" },
        as: :json
    end

    assert_response :success
    assert_equal({ "url" => "https://github.com/acme/elef/issues/27" }, response.parsed_body)
    assert_equal "Bug: The page remains open", creator.arguments[:title]
    assert_includes creator.arguments[:body], "**Expected:** The page closes"
    assert_includes creator.arguments[:body], "**Actual:** The page remains open"
    assert_includes creator.arguments[:body], "1. Click Edit\n2. Press Enter"
    assert_includes creator.arguments[:body], "Browser: Firefox 140\\.0; OS: Linux"
  end

  test "returns validation errors before contacting GitHub" do
    creator = FakeIssueCreator.new
    with_issue_creator(creator) do
      post bug_reports_path, params: { bug_report: { expected: "", actual: "", steps: "" } }, as: :json
    end

    assert_response :unprocessable_content
    assert_equal "Add what you expected to happen.", response.parsed_body.dig("errors", "expected")
    assert_nil creator.arguments
  end

  test "rejects empty numbered steps and malformed report parameters without contacting GitHub" do
    creator = FakeIssueCreator.new
    with_issue_creator(creator) do
      post bug_reports_path, params: { bug_report: { expected: "Expected", actual: "Actual", steps: "1. \n" } }, as: :json
    end
    assert_response :unprocessable_content
    assert_equal "Add at least one reproduction step.", response.parsed_body.dig("errors", "steps")

    with_issue_creator(creator) do
      post bug_reports_path, params: { bug_report: "unexpected" }, as: :json
    end
    assert_response :unprocessable_content
    assert_equal "Add what you expected to happen.", response.parsed_body.dig("errors", "expected")
    assert_nil creator.arguments
  end

  test "returns a useful GitHub error for the client to display without losing form contents" do
    creator = FakeIssueCreator.new(result: FakeResult.new(false, nil, "GitHub issue reporting is not configured."))
    with_issue_creator(creator) do
      post bug_reports_path,
        params: { bug_report: { expected: "Keep this", actual: "Keep this too", steps: "1. Try again" } },
        as: :json
    end

    assert_response :service_unavailable
    assert_equal "GitHub issue reporting is not configured.", response.parsed_body["error"]
    assert_equal "Keep this", creator.arguments[:body].match(/\*\*Expected:\*\* (.+)/)[1]
  end

  test "limits issue creation attempts per source IP and returns a useful 429 response" do
    creator = FakeIssueCreator.new
    with_issue_creator(creator) do
      5.times do
        post bug_reports_path,
          params: { bug_report: { expected: "Expected", actual: "Actual", steps: "1. Reproduce" } },
          as: :json
        assert_response :success
      end

      post bug_reports_path,
        params: { bug_report: { expected: "Expected", actual: "Actual", steps: "1. Reproduce" } },
        as: :json
    end

    assert_response :too_many_requests
    assert_equal "Too many bug reports were submitted. Wait a few minutes and try again.", response.parsed_body["error"]
    assert_equal 5, creator.call_count
  end

  private

  def with_issue_creator(creator)
    original_new = BugReports::GithubIssueCreator.method(:new)
    BugReports::GithubIssueCreator.define_singleton_method(:new) { creator }
    yield
  ensure
    BugReports::GithubIssueCreator.define_singleton_method(:new, original_new) if original_new
  end
end
