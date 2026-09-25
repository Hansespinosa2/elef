require "test_helper"
require "selenium/webdriver"

chromedriver = ENV["CHROMEDRIVER_PATH"]
chromedriver ||= %w[/usr/bin/chromedriver /usr/local/bin/chromedriver].find do |path|
  File.executable?(path)
end
Selenium::WebDriver::Chrome::Service.driver_path = chromedriver if chromedriver

class ApplicationSystemTestCase < ActionDispatch::SystemTestCase
  chrome_binary = ENV.fetch("CHROME_BINARY", "/usr/bin/chromium")
  chromedriver_path = ENV.fetch("CHROMEDRIVER_PATH", "/usr/bin/chromedriver")
  Selenium::WebDriver::Chrome::Service.driver_path = chromedriver_path if File.executable?(chromedriver_path)

  driven_by :selenium, using: :headless_chrome, screen_size: [1400, 1000] do |options|
    options.binary = chrome_binary if File.executable?(chrome_binary)
    options.add_argument("--headless=new")
    options.add_argument("--disable-gpu")
    options.add_argument("--no-sandbox")
    options.add_argument("--disable-dev-shm-usage")
    options.add_argument("--disable-notifications")
    options.add_argument("--disable-background-timer-throttling")
    options.add_argument("--disable-backgrounding-occluded-windows")
  end
end
