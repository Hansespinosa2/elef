require "test_helper"

class ApplicationSystemTestCase < ActionDispatch::SystemTestCase
  # Prefer a locally installed matching driver; Selenium Manager may not ship
  # a binary for the architecture used by the isolated development container.
  installed_driver = ENV["SE_CHROMEDRIVER"] || ENV.fetch("PATH", "").split(File::PATH_SEPARATOR)
    .map { |directory| File.join(directory, "chromedriver") }.find { |path| File.executable?(path) }
  Selenium::WebDriver::Chrome::Service.driver_path = installed_driver if installed_driver

  driven_by :selenium, using: :headless_chrome, screen_size: [1400, 1000] do |options|
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-notifications")
    options.add_argument("--renderer-process-limit=1")
  end
end
