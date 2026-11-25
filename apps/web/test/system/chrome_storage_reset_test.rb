require "application_system_test_case"

class ChromeStorageResetTest < ApplicationSystemTestCase
  test "browser reset clears cookies and local storage for the app origin" do
    visit root_path
    page.execute_script(<<~JS)
      document.cookie = "elef_reset_probe=present; path=/";
      localStorage.setItem("elef_reset_probe", "present");
    JS
    assert_equal "present", page.evaluate_script('localStorage.getItem("elef_reset_probe")')
    assert_includes page.evaluate_script("document.cookie"), "elef_reset_probe=present"

    page.execute_script('window.open("about:blank", "_blank")')
    page.switch_to_window(page.windows.last)
    Capybara.reset_sessions!
    visit root_path
    assert_nil page.evaluate_script('localStorage.getItem("elef_reset_probe")')
    refute_includes page.evaluate_script("document.cookie"), "elef_reset_probe=present"
  end
end
