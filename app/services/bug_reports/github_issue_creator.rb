require "json"
require "net/http"
require "uri"

module BugReports
  class GithubIssueCreator
    Result = Data.define(:success?, :url, :error)
    REPOSITORY_FORMAT = /\A[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+\z/

    def initialize(token: ENV["GITHUB_TOKEN"], repository: ENV["GITHUB_REPOSITORY"], http: Net::HTTP)
      @token = token.to_s.strip
      @repository = repository.to_s.strip
      @http = http
    end

    def call(title:, body:)
      configuration_error = validate_configuration
      return Result.new(false, nil, configuration_error) if configuration_error

      uri = URI("https://api.github.com/repos/#{@repository}/issues")
      request = Net::HTTP::Post.new(uri)
      request["Accept"] = "application/vnd.github+json"
      request["Authorization"] = "Bearer #{@token}"
      request["Content-Type"] = "application/json"
      request["User-Agent"] = "Elef"
      request["X-GitHub-Api-Version"] = "2022-11-28"
      request.body = JSON.generate(title: title, body: body)

      response = @http.start(uri.host, uri.port, use_ssl: true, open_timeout: 3, read_timeout: 10) do |connection|
        connection.request(request)
      end
      response_result(response)
    rescue Timeout::Error, SocketError, OpenSSL::SSL::SSLError, IOError, SystemCallError
      Result.new(false, nil, "GitHub could not be reached. Your report is still available; please try again.")
    end

    private

    def validate_configuration
      if @token.empty? || @repository.empty?
        "GitHub issue reporting is not configured. Set GITHUB_TOKEN and GITHUB_REPOSITORY on the Elef server."
      elsif !REPOSITORY_FORMAT.match?(@repository)
        "GitHub issue reporting is not configured. GITHUB_REPOSITORY must use owner/repository format."
      end
    end

    def response_result(response)
      code = response.code.to_i
      if code.between?(200, 299)
        url = safe_issue_url(parse_response(response.body)["html_url"])
        Result.new(true, url, nil)
      else
        Result.new(false, nil, response_error(code))
      end
    rescue JSON::ParserError
      Result.new(false, nil, "GitHub returned an unreadable response. Your report is still available; please try again.")
    end

    def parse_response(body)
      parsed = JSON.parse(body.to_s)
      raise JSON::ParserError, "Expected an object response" unless parsed.is_a?(Hash)

      parsed
    end

    def safe_issue_url(value)
      uri = URI.parse(value.to_s)
      uri.to_s if uri.is_a?(URI::HTTPS) && uri.host == "github.com" && uri.path.start_with?("/#{@repository}/issues/")
    rescue URI::InvalidURIError
      nil
    end

    def response_error(code)
      case code
      when 401
        "GitHub rejected the server credentials. Check the GITHUB_TOKEN configuration."
      when 403
        "The GitHub token cannot create issues in this repository. Check its repository access and permissions."
      when 404
        "The configured GitHub repository was not found or is not accessible to the server token."
      when 422
        "GitHub rejected the issue contents. Edit the report and try again."
      when 500..599
        "GitHub is temporarily unavailable. Your report is still available; please try again."
      else
        "GitHub did not accept the issue request (HTTP #{code}). Your report is still available; please try again."
      end
    end
  end
end
