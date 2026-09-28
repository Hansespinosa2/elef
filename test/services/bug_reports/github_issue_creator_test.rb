require "test_helper"

class BugReports::GithubIssueCreatorTest < ActiveSupport::TestCase
  Response = Data.define(:code, :body)

  class FakeHttp
    attr_reader :host, :port, :options, :sent_request

    def initialize(response:)
      @response = response
    end

    def start(host, port, **options)
      @host = host
      @port = port
      @options = options
      yield self
    end

    def request(request)
      @sent_request = request
      raise @response if @response.is_a?(Exception)

      @response
    end
  end

  test "posts the deterministic title and body to the configured repository with server authentication" do
    http = FakeHttp.new(response: Response.new("201", { "html_url" => "https://github.com/acme/elef/issues/27" }.to_json))
    creator = BugReports::GithubIssueCreator.new(token: "server-secret", repository: "acme/elef", http: http)

    result = creator.call(title: "Bug: Save failed", body: "Expected and actual details")

    assert_predicate result, :success?
    assert_equal "https://github.com/acme/elef/issues/27", result.url
    assert_equal "api.github.com", http.host
    assert_equal 443, http.port
    assert_equal true, http.options[:use_ssl]
    assert_equal "/repos/acme/elef/issues", http.sent_request.path
    assert_equal "Bearer server-secret", http.sent_request["Authorization"]
    assert_equal({ "title" => "Bug: Save failed", "body" => "Expected and actual details" }, JSON.parse(http.sent_request.body))
    refute_includes http.sent_request.body, "server-secret"
  end

  test "handles GitHub permission and validation errors without returning response bodies" do
    [
      ["403", "The GitHub token cannot create issues"],
      ["422", "GitHub rejected the issue contents"]
    ].each do |code, expected_error|
      http = FakeHttp.new(response: Response.new(code, { "message" => "private upstream detail" }.to_json))
      result = BugReports::GithubIssueCreator.new(token: "server-secret", repository: "acme/elef", http: http).call(title: "Bug", body: "Body")

      refute_predicate result, :success?
      assert_includes result.error, expected_error
      refute_includes result.error, "private upstream detail"
    end
  end

  test "handles missing credentials and invalid repository names without making an API request" do
    http = FakeHttp.new(response: RuntimeError.new("API must not be called"))
    missing = BugReports::GithubIssueCreator.new(token: "", repository: "acme/elef", http: http).call(title: "Bug", body: "Body")
    invalid_repository = BugReports::GithubIssueCreator.new(token: "server-secret", repository: "https://github.com/acme/elef", http: http).call(title: "Bug", body: "Body")
    traversal_repository = BugReports::GithubIssueCreator.new(token: "server-secret", repository: "../issues", http: http).call(title: "Bug", body: "Body")

    refute_predicate missing, :success?
    assert_includes missing.error, "GITHUB_TOKEN and GITHUB_REPOSITORY"
    refute_predicate invalid_repository, :success?
    assert_includes invalid_repository.error, "owner/repository"
    refute_predicate traversal_repository, :success?
    assert_includes traversal_repository.error, "owner/repository"
    assert_nil http.host
  end

  test "returns a useful error for network and malformed API failures" do
    network_http = FakeHttp.new(response: SocketError.new("offline"))
    network_result = BugReports::GithubIssueCreator.new(token: "server-secret", repository: "acme/elef", http: network_http).call(title: "Bug", body: "Body")
    malformed_http = FakeHttp.new(response: Response.new("201", "not-json"))
    malformed_result = BugReports::GithubIssueCreator.new(token: "server-secret", repository: "acme/elef", http: malformed_http).call(title: "Bug", body: "Body")

    refute_predicate network_result, :success?
    assert_includes network_result.error, "could not be reached"
    refute_predicate malformed_result, :success?
    assert_includes malformed_result.error, "unreadable response"
  end
end
