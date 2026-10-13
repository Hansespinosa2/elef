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

  teardown do
    # Browser storage survives Capybara's session reset (cookies are cleared,
    # localStorage/IndexedDB are not), and one process reuses its browser
    # across tests. Drafts persist primarily in IndexedDB (localStorage is
    # only the fallback), so without this a draft typed by one test restores
    # into the next test's blank form. Every test starts from the blank slate
    # the suite assumes; within-test restore stays pinned by the
    # refresh-recovers-draft coverage. A pending delete unblocks when the next
    # test navigates, and the reopened database starts empty.
    begin
      page.execute_script("localStorage.clear(); sessionStorage.clear(); try { indexedDB.deleteDatabase('elef-drafts'); } catch (_e) {}")
    rescue Selenium::WebDriver::Error::WebDriverError
      # No page was ever visited; nothing to clear.
    end
  end
end
