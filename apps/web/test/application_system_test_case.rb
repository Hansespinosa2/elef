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

  setup do
    # One browser is reused across tests, and Capybara's reset clears cookies
    # plus session/local storage but never IndexedDB — where Elef persists
    # drafts. Without this, a draft typed by one test restores into the next
    # test's blank form. The sacrificial visit absorbs any leaked restore into
    # a throwaway page then wipes the store, so the test's own visits start
    # clean. (Clearing in teardown cannot work: reset navigates to about:blank
    # first, whose opaque origin denies IndexedDB, and a fire-and-forget
    # delete stays blocked behind the page's open connection.)
    visit root_path
    page.evaluate_async_script(<<~JAVASCRIPT)
      var done = arguments[arguments.length - 1];
      try { localStorage.clear(); sessionStorage.clear(); } catch (_e) {}
      try {
        if (!window.indexedDB) { done("no-idb"); return; }
        var openRequest = indexedDB.open("elef-drafts", 1);
        openRequest.onupgradeneeded = function() {
          if (!openRequest.result.objectStoreNames.contains("drafts")) {
            openRequest.result.createObjectStore("drafts", { keyPath: "key" });
          }
        };
        openRequest.onsuccess = function() {
          var database = openRequest.result;
          try {
            if (!database.objectStoreNames.contains("drafts")) { done("no-store"); return; }
            var transaction = database.transaction("drafts", "readwrite");
            transaction.oncomplete = function() { done("cleared"); };
            transaction.onerror = function() { done("clear-error"); };
            transaction.onabort = function() { done("clear-abort"); };
            transaction.objectStore("drafts").clear();
          } catch (error) { done("tx-error"); }
        };
        openRequest.onerror = function() { done("open-error"); };
        openRequest.onblocked = function() { done("open-blocked"); };
      } catch (error) { done("js-error"); }
    JAVASCRIPT
  end
end
