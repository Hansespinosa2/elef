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

  test "classifies browser ordering and mobile desktop operating systems" do
    cases = [
      ["Edge over Chromium", "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/126.0 Safari/537.36 Edg/126.0", "Edge 126.0", "Windows"],
      ["Opera over Chromium", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36 OPR/111.0", "Opera 111.0", "Linux"],
      ["Safari version", "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 Version/17.5 Safari/605.1.15", "Safari 17.5", "macOS"],
      ["iOS before macOS", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1", "Safari 17.0", "iOS"],
      ["Android before Linux", "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/124.0 Mobile Safari/537.36", "Chrome 124.0", "Android"],
      ["ChromeOS before Linux", "Mozilla/5.0 (X11; CrOS x86_64 15823.58.0) AppleWebKit/537.36 Chrome/120.0 Safari/537.36", "Chrome 120.0", "ChromeOS"],
      ["Linux", "Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0", "Firefox 128.0", "Linux"]
    ]

    cases.each do |name, user_agent, browser, operating_system|
      environment = BugReports::Environment.new(user_agent:, build_id: "matrix", rails_version: "8.1.test").to_s
      assert_includes environment, "Browser: #{browser}", name
      assert_includes environment, "OS: #{operating_system}", name
    end
  end

  test "defaults build id from the environment and truncates long user agents" do
    previous_build_id = ENV["ELEF_BUILD_ID"]
    ENV["ELEF_BUILD_ID"] = "environment-build"
    environment = BugReports::Environment.new(user_agent: "Firefox/131.0 #{'x' * 600} Linux", rails_version: "8.1.test").to_s

    assert_includes environment, "Elef build: environment-build"
    assert_includes environment, "Browser: Firefox 131.0"
    assert_includes environment, "OS: Unknown OS"
  ensure
    if previous_build_id.nil?
      ENV.delete("ELEF_BUILD_ID")
    else
      ENV["ELEF_BUILD_ID"] = previous_build_id
    end
  end
end
