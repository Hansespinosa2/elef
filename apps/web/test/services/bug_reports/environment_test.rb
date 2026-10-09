require "test_helper"

class BugReports::EnvironmentTest < ActiveSupport::TestCase
  test "includes configured build id, Rails version, browser, and operating system" do
    environment = BugReports::Environment.new(
      user_agent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0.0.0 Safari/537.36",
      build_id: "release-abc123",
      rails_version: "8.1.test"
    )

    assert_equal "Elef build: release-abc123; Rails: 8.1.test; Browser: Chrome 126.0.0.0; OS: Windows", environment.to_s
  end

  test "uses explicit fallbacks when runtime information is unavailable" do
    environment = BugReports::Environment.new(user_agent: nil, build_id: nil, rails_version: "8.1.test")

    assert_equal "Elef build: unavailable; Rails: 8.1.test; Browser: Unknown browser; OS: Unknown OS", environment.to_s
  end
end
