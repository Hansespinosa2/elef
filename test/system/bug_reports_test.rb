require "application_system_test_case"

class BugReportsTest < ApplicationSystemTestCase
  test "snapshots before opening, keeps reporter activity out, allows editing, and preserves a failed report" do
    visit root_path
    assert_selector '#bug-report-recording-disclosure', visible: true, text: /typed text.*automatically kept in memory for up to 60 seconds.*may be included/i
    assert_selector 'button[aria-describedby="bug-report-recording-disclosure"]', text: "Report Bug"
    controller_loaded = Selenium::WebDriver::Wait.new(timeout: 5).until do
      page.evaluate_script('Boolean(window.Stimulus.getControllerForElementAndIdentifier(document.querySelector(".bug-report-root"), "bug-report"))')
    end
    assert controller_loaded
    find('button[aria-label="Open command palette"]').click
    find('[data-command-palette-target="input"]').send_keys(:escape)
    click_button "Report Bug"

    assert_selector "dialog#bug-report-dialog[open]"
    steps_field = find_field("Steps to reproduce")
    generated_steps = steps_field.value
    assert_includes generated_steps, 'Clicked "Open command palette"'
    assert_includes generated_steps, "Pressed Escape"
    refute_includes generated_steps, "Report Bug"

    fill_in "Expected behavior", with: "The palette closes"
    fill_in "Actual behavior", with: "It remained open"
    assert_equal generated_steps, steps_field.value
    fill_in "Steps to reproduce", with: "1. Open Commands\n2. Choose Search"
    assert_equal "1. Open Commands\n2. Choose Search", steps_field.value

    page.execute_script(<<~JS)
      window.bugReportRequest = null;
      window.fetch = async (url, options) => {
        window.bugReportRequest = { url, body: JSON.parse(options.body) };
        return { ok: false, status: 503, json: async () => ({ error: "GitHub is temporarily unavailable." }) };
      };
    JS
    click_button "Create GitHub issue"

    assert_selector '[role="alert"]', text: "GitHub is temporarily unavailable."
    assert_equal "The palette closes", find_field("Expected behavior").value
    assert_equal "It remained open", find_field("Actual behavior").value
    assert_equal "1. Open Commands\n2. Choose Search", steps_field.value
    assert_equal "/bug_reports", page.evaluate_script("window.bugReportRequest.url")
    assert_equal({ "expected" => "The palette closes", "actual" => "It remained open", "steps" => "1. Open Commands\n2. Choose Search" }, page.evaluate_script("window.bugReportRequest.body.bug_report"))

    page.execute_script(<<~JS)
      window.fetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({ url: "https://github.com/acme/elef/issues/27" })
      });
    JS
    click_button "Create GitHub issue"

    assert_selector '[data-bug-report-target="success"][role="status"]', text: "Bug report submitted."
    assert_selector '[data-bug-report-target="issueLink"][href="https://github.com/acme/elef/issues/27"]', text: "View GitHub issue"

    click_button "Done"
    click_button "Report Bug"
    later_steps = find_field("Steps to reproduce").value
    assert_includes later_steps, 'Clicked "Open command palette"'
    refute_includes later_steps, "Report Bug"
    refute_includes later_steps, "The palette closes"
    refute_includes later_steps, "It remained open"
    refute_includes later_steps, "Choose Search"
  end
end
