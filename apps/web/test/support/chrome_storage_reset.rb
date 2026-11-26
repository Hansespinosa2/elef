# Capybara 3.40 resets Chrome by passing a wildcard to Storage.clearDataForOrigin.
# Chrome 158 rejects that origin. A fresh temporary browser profile provides the
# same isolation across all origins and windows until Capybara supports it.
require "capybara/selenium/driver_specializations/chrome_driver"

module ChromeStorageReset
  def reset!
    return super unless @browser && @browser.capabilities.browser_version.to_i >= 158

    quit
  end
end

Capybara::Selenium::Driver::ChromeDriver.prepend(ChromeStorageReset)
