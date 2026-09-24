require "application_system_test_case"

class PresentationsTest < ApplicationSystemTestCase
  def hold_autosaves
    page.execute_script(<<~JAVASCRIPT)
      window.autosaveRequests = [];
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options) => {
        if (options?.method !== 'PATCH') return originalFetch(url, options);
        return new Promise((resolve, reject) => {
          window.autosaveRequests.push({
            release: () => originalFetch(url, options).then(resolve, reject)
          });
        });
      };
    JAVASCRIPT
  end

  def wait_for_autosave_request(index)
    ready = page.evaluate_async_script(<<~JAVASCRIPT, index)
      const target = arguments[0];
      const done = arguments[arguments.length - 1];
      const deadline = Date.now() + 5000;
      const wait = () => {
        if ((window.autosaveRequests || []).length > target) return done(true);
        if (Date.now() >= deadline) return done(false);
        window.setTimeout(wait, 10);
      };
      wait();
    JAVASCRIPT
    assert ready, "autosave request #{index} was not registered"
  end

  test "library renames forks and deletes a presentation through its controls" do
    parent = Presentation.create!(title: "Workflow parent", source: "# Keep this source")
    visit presentations_path
    within("#presentation_#{parent.id}") do
      find("summary", text: "Rename").click
      find('input[aria-label="Rename Workflow parent"]').set("Renamed parent")
      click_on "Save title"
    end
    assert_text "Presentation renamed."
    within("article", text: "Renamed parent") do
      find("summary", text: "Fork").click
      click_on "As inspiration"
    end
    assert_field "Title", with: "Renamed parent (Inspiration)"
    click_on "Library"
    within("#presentation_#{parent.id}") do
      accept_confirm { click_on "Delete" }
    end
    assert_text "Presentation deleted."
    assert_text "Parent no longer available"
    assert_equal "# Keep this source", Presentation.find_by!(parent_id: nil, fork_type: "inspiration").source
  end

  test "autosave persists newer edits after an outstanding request and keeps them dirty until saved" do
    presentation = Presentation.create!(title: "Autosave order", source: "# Original")
    visit edit_presentation_path(presentation)
    hold_autosaves
    fill_in "Markdown source", with: "# First edit"
    assert_selector '[data-autosave-target="status"]', text: "Saving…"
    fill_in "Markdown source", with: "# Original"
    dismiss_confirm { click_on "Library" }
    assert_field "Markdown source", with: "# Original"
    fill_in "Markdown source", with: "# Latest edit"
    wait_for_autosave_request(0)
    page.execute_script("window.autosaveRequests[0].release()")
    assert_selector '[data-autosave-target="status"]', text: "Saving…"
    dismiss_confirm { click_on "Library" }
    assert_field "Markdown source", with: "# Latest edit"
    assert_includes presentation.reload.source, "# First edit"
    wait_for_autosave_request(1)
    page.execute_script("window.autosaveRequests[1].release()")
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved"
    assert_includes presentation.reload.source, "# Latest edit"
    click_on "Library"
    assert_current_path root_path
  end

  test "library tabs use canonical collection paths" do
    visit root_path

    assert_current_path root_path
    assert_link "Library", href: root_path
    within "nav.library-tabs" do
      assert_link "All", href: root_path
      assert_link "Documents", href: documents_path
      assert_link "Presentations", href: presentations_path
      click_on "Documents"
    end

    assert_current_path documents_path
    within "nav.library-tabs" do
      click_on "Presentations"
    end

    assert_current_path presentations_path
  end

  test "two editor tabs preserve a stale local draft as a recovery revision" do
    presentation = Presentation.create!(title: "Two tabs", source: "# Initial")
    visit edit_presentation_path(presentation)

    using_session(:server_tab) do
      visit edit_presentation_path(presentation)
      fill_in "Markdown source", with: "# Server tab"
      assert_selector '[data-autosave-target="status"]', text: "Saved", wait: 5
    end

    fill_in "Markdown source", with: "# Local tab"
    assert_selector '[data-autosave-target="status"]', text: "A newer version is active; your draft was preserved.", wait: 5
    assert_selector "[data-autosave-target='conflict']", visible: true
    assert_includes presentation.reload.source, "# Server tab"
    assert_includes presentation.revisions.recoveries.order(:id).last.source, "# Local tab"
  end

  test "refresh recovers an unsent draft from browser persistence" do
    presentation = Presentation.create!(title: "Refresh recovery", source: "# Initial")
    visit edit_presentation_path(presentation)
    hold_autosaves
    fill_in "Markdown source", with: "# Unsent after refresh"
    assert_selector '[data-autosave-target="status"]', text: "Saving…", wait: 5

    page.refresh

    assert_field "Markdown source", with: "# Unsent after refresh", wait: 5
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 5
    assert_includes presentation.reload.source, "# Unsent after refresh"
  end

  test "explicit save waits for autosave and refreshes the latest preview" do
    presentation = Presentation.create!(title: "Manual save order", source: "# Original")
    visit edit_presentation_path(presentation)
    hold_autosaves
    fill_in "Markdown source", with: "# Earlier edit"
    assert_selector '[data-autosave-target="status"]', text: "Saving…"
    fill_in "Markdown source", with: "# Manual latest"
    click_on "Save presentation"
    page.execute_script("window.autosaveRequests[0].release()")
    assert_text "Presentation saved."
    assert_selector '.preview-pane .slide', text: "Manual latest"
    assert_includes presentation.reload.source, "# Manual latest"
  end

  test "presents from the edit screen without submitting the editor form" do
    presentation = Presentation.create!(title: "Edit presentation", source: "# Original")

    visit edit_presentation_path(presentation)
    click_on "Present"

    assert_current_path present_presentation_path(presentation)
    assert_selector "body.presentation-body"
    assert_equal "# Original", presentation.reload.source
    assert_not_nil presentation.last_published_at
  end

  test "visual presentation editing updates source and known slide operations" do
    presentation = Presentation.create!(title: "Visual deck", source: "# First\n\nBody\n---\n# Second\n\nOther")

    visit edit_presentation_path(presentation)

    find(".slide-block", text: "Body").click
    page.execute_script("const block = [...document.querySelectorAll('.slide-block')].find((candidate) => candidate.innerText === 'Body'); block.innerText = 'Changed'; block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Changed' }));")
    assert_field "Markdown source", with: /# First\n\nChanged/, wait: 5
    find("[data-presentation-editor-action='add-slide-after']", match: :first).click
    assert_selector ".presentation-editor-projection .slide", count: 3, wait: 5
    accept_confirm { all("[data-presentation-editor-action='delete-slide']").last.click }
    assert_selector ".presentation-editor-projection .slide", count: 2, wait: 5

    find("select[data-presentation-editor-position][data-slide-index='0'][data-block-index='1']").select("Center Middle")
    assert_field "Markdown source", with: /:::position\{center middle\}/, wait: 5

    click_on "Save presentation"
    assert_text "Presentation saved."
    visit edit_presentation_path(presentation)
    assert_field "Markdown source", with: /Changed/
    assert_selector ".presentation-editor-projection .slide", count: 2
  end

  test "visual presentation editing keeps tables and media as Markdown structures" do
    presentation = Presentation.create!(
      title: "Rich deck",
      source: "# Rich\n\nA **message**.\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n\n![Old alt](/icon.svg)"
    )

    visit edit_presentation_path(presentation)

    page.execute_script(<<~JAVASCRIPT)
      const block = [...document.querySelectorAll('.slide-block')]
        .find((candidate) => candidate.querySelector('strong'));
      block.querySelector('strong').innerText = 'updated';
      block.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'updated' }));
    JAVASCRIPT
    assert_field "Markdown source", with: /A \*\*updated\*\*\./, wait: 5

    page.execute_script(<<~JAVASCRIPT)
      const tableBlock = [...document.querySelectorAll('.slide-block')]
        .find((block) => block.querySelector('table'));
      tableBlock.querySelector('tbody td').innerText = 'Updated';
      tableBlock.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Updated' }));
    JAVASCRIPT
    assert_field "Markdown source", with: /\| Updated \| Two \|/, wait: 5

    page.execute_script(<<~JAVASCRIPT)
      const imageBlock = [...document.querySelectorAll('.slide-block')]
        .find((block) => block.querySelector('.editor-media-caption'));
      const caption = imageBlock.querySelector('.editor-media-caption');
      caption.innerText = 'New alt';
      caption.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'New alt' }));
    JAVASCRIPT
    assert_field "Markdown source", with: /!\[New alt\]\(\/icon\.svg\)/, wait: 5
    assert_includes find_field("Markdown source").value, "| Updated | Two |"
  end

  test "source mode keeps unsupported presentation directives available" do
    presentation = Presentation.create!(title: "Source fallback", source: "# Visible\n\n:::custom-directive{value}\n\nContent")

    visit edit_presentation_path(presentation)

    assert_equal "visual", page.evaluate_script("document.querySelector('form.visual-editor-form').dataset.editorMode")
    assert_text "Unknown or malformed presentation directive was removed."
    click_on "Source"
    assert_selector ".cm-content", visible: true
    assert_includes find_field("Markdown source").value, ":::custom-directive{value}"
    click_on "Visual"
    assert_selector ".presentation-editor-projection", visible: true
    assert_includes find_field("Markdown source").value, ":::custom-directive{value}"
  end

  test "visual presentation controls reorder blocks and slides without losing source text" do
    presentation = Presentation.create!(
      title: "Structural deck",
      source: "# First\n\nFirst block\n\nSecond block\n---\n# Second\n\nOther block"
    )

    visit edit_presentation_path(presentation)
    dismiss_confirm do
      find("[data-presentation-editor-action='delete-block'][data-slide-index='0'][data-block-index='1']").click
    end
    assert_field "Markdown source", with: "# First\n\nFirst block\n\nSecond block\n---\n# Second\n\nOther block"

    find("[data-presentation-editor-action='move-block-down'][data-slide-index='0'][data-block-index='1']").click
    assert_field "Markdown source", with: /# First\n\nSecond block\n\nFirst block/, wait: 5
    assert_no_selector "[data-presentation-editor-action='add-block-after'][data-slide-index='0'][data-block-index='1'][disabled]", wait: 5

    find("[data-presentation-editor-action='add-block-after'][data-slide-index='0'][data-block-index='1']").click
    assert_field "Markdown source", with: /Second block\n\nNew block\n\nFirst block/, wait: 5
    assert_no_selector "[data-presentation-editor-action='delete-block'][data-slide-index='0'][data-block-index='2'][disabled]", wait: 5

    accept_confirm { find("[data-presentation-editor-action='delete-block'][data-slide-index='0'][data-block-index='2']").click }
    assert_field "Markdown source", with: /Second block\n\nFirst block/, wait: 5
    assert_no_selector "[data-presentation-editor-action='move-slide-down'][data-slide-index='0'][disabled]", wait: 5

    find("[data-presentation-editor-action='move-slide-down'][data-slide-index='0']").click
    assert_field "Markdown source", with: /# Second\n\nOther block\n---\n# First\n\nSecond block\n\nFirst block/, wait: 5
  end

  test "keeps the last good presentation projection when preview is unavailable and offers retry" do
    presentation = Presentation.create!(title: "Stable deck", source: "# Stable\n\nLast good slide")
    visit edit_presentation_path(presentation)
    assert_selector ".presentation-editor-projection .slide", text: "Last good slide"

    page.execute_script(<<~JAVASCRIPT)
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        if (options.method === "POST" && String(url).includes("/preview")) {
          window.fetch = originalFetch;
          return Promise.reject(new Error("Simulated preview outage"));
        }
        return originalFetch(url, options);
      };
    JAVASCRIPT

    fill_in "Markdown source", with: "# Broken\n\nNew slide text"
    assert_selector '[data-preview-target="status"]', text: "Preview unavailable", wait: 5
    assert_selector '[data-preview-target="warnings"]', text: "Preview could not be reached. Your source is still safe; try again shortly."
    assert_selector ".presentation-editor-projection .slide", text: "Last good slide"
    assert_no_selector ".presentation-editor-projection .slide", text: "New slide text"
    assert_field "Markdown source", with: "# Broken\n\nNew slide text"
    assert_selector "[data-presentation-editor-action='add-slide-after'][disabled]"
    assert_selector '[data-preview-target="retry"]', visible: true

    click_on "Retry preview"
    assert_selector ".presentation-editor-projection .slide", text: "New slide text", wait: 5
    assert_selector '[data-preview-target="warnings"]', visible: false
    assert_selector '[data-preview-target="retry"]', visible: false
    assert_no_selector "[data-presentation-editor-action='add-slide-after'][disabled]"
  end

  test "failed autosave can be retried and validation errors preserve saved source" do
    presentation = Presentation.create!(title: "Retry deck", source: "# Original")
    visit edit_presentation_path(presentation)
    page.execute_script(<<~JAVASCRIPT)
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options) => {
        if (options?.method !== 'PATCH') return originalFetch(url, options);
        window.fetch = originalFetch;
        return Promise.reject(new Error('Simulated connection failure'));
      };
    JAVASCRIPT
    fill_in "Markdown source", with: "# Recovered"
    assert_selector '[data-autosave-target="status"]', text: "Save failed"
    assert_equal "# Original", presentation.reload.source
    click_on "Retry save"
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved"
    assert_includes presentation.reload.source, "# Recovered"

    fill_in "Title", with: "x" * 121
    assert_selector '[data-autosave-target="status"]', text: "Save failed"
    assert_equal "Retry deck", presentation.reload.title
    fill_in "Title", with: "Valid title"
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved"
    assert_equal "Valid title", presentation.reload.title
  end

  test "recovers the browser draft after an autosave outage and reload" do
    presentation = Presentation.create!(title: "Offline recovery", source: "# Original")
    visit edit_presentation_path(presentation)
    page.execute_script(<<~JAVASCRIPT)
      const originalFetch = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        if (options.method === "PATCH") {
          window.fetch = originalFetch;
          return Promise.reject(new TypeError("Failed to fetch"));
        }
        return originalFetch(url, options);
      };
    JAVASCRIPT

    fill_in "Markdown source", with: "# Offline edit"
    assert_selector '[data-autosave-target="status"]', text: "Save failed", wait: 5
    assert_equal "# Original", presentation.reload.source

    page.refresh

    assert_field "Markdown source", with: "# Offline edit", wait: 5
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 5
    assert_includes presentation.reload.source, "# Offline edit"
  end

  test "times out a stalled autosave and lets the user retry the latest edit" do
    presentation = Presentation.create!(title: "Stalled save", source: "# Original")
    visit edit_presentation_path(presentation)
    page.execute_script(<<~JAVASCRIPT)
      const form = document.querySelector('form[data-controller~="autosave"]');
      form.setAttribute("data-autosave-timeout-value", "1200");
      window.saveStarted = false;
      window.fetchForSaveRetry = window.fetch.bind(window);
      window.fetch = (url, options = {}) => {
        if (options.method === "PATCH") {
          window.saveStarted = true;
          return new Promise(() => {});
        }
        return window.fetchForSaveRetry(url, options);
      };
    JAVASCRIPT

    fill_in "Markdown source", with: "# First edit"
    save_started = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[arguments.length - 1];
      const deadline = Date.now() + 5000;
      const waitForSave = () => {
        if (window.saveStarted) return done(true);
        if (Date.now() >= deadline) return done(false);
        window.setTimeout(waitForSave, 10);
      };
      waitForSave();
    JAVASCRIPT
    assert save_started, "autosave request did not start"

    fill_in "Markdown source", with: "# Latest edit"
    assert_field "Markdown source", with: "# Latest edit"
    assert_selector '[data-autosave-target="status"]', text: "Save timed out", wait: 5
    assert_selector '[data-autosave-target="retry"]', visible: true
    assert_equal "# Original", presentation.reload.source

    page.execute_script("window.fetch = window.fetchForSaveRetry")
    click_on "Retry save"

    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 5
    assert_includes presentation.reload.source, "# Latest edit"
  end

  def assert_timeline_geometry
    geometry = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const nodes = [...document.querySelectorAll('.lineage-node')];
        const boxes = nodes.map(n => n.getBoundingClientRect());
        const overlaps = [];
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b, j) => {
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top)
            overlaps.push([nodes[i].dataset.lineageGraphId, nodes[i+j+1].dataset.lineageGraphId]);
        }));
        const edges = [...document.querySelectorAll('.lineage-edge')].map(edge => {
          const parent = document.querySelector('[data-lineage-graph-id="' + edge.dataset.lineageEdgeFrom + '"]').getBoundingClientRect();
          const child = document.querySelector('[data-lineage-graph-id="' + edge.dataset.lineageEdgeTo + '"]').getBoundingClientRect();
          const point = distance => {
            const p = edge.getPointAtLength(distance);
            return new DOMPoint(p.x, p.y).matrixTransform(edge.getScreenCTM());
          };
          const start = point(0), end = point(edge.getTotalLength());
          return { startError: Math.hypot(start.x-parent.right, start.y-(parent.top+parent.height/2)),
            endError: Math.hypot(end.x-child.left, end.y-(child.top+child.height/2)),
            forward: child.left > parent.right,
            marker: !!document.querySelector(edge.getAttribute('marker-end').slice(4,-1)) };
        });
        return { overlaps, edges, slides: nodes.map((n,i) => {
          const s = n.querySelector('.slide').getBoundingClientRect(), b = boxes[i];
          return { ratio: b.width/b.height, left: s.left-b.left, top: s.top-b.top,
            width: s.width-b.width, height: s.height-b.height };
        }) };
      })()
    JAVASCRIPT
    assert_empty geometry["overlaps"], "Slide cards overlap in the browser"
    geometry["slides"].each do |slide|
      assert_in_delta 16.0 / 9, slide["ratio"], 0.01
      %w[left top width height].each { |dimension| assert_in_delta 0, slide[dimension], 1 }
    end
    geometry["edges"].each do |edge|
      assert_operator edge["startError"], :<, 1, "Edge misses the visible parent boundary"
      assert_operator edge["endError"], :<, 1, "Edge misses the visible child boundary"
      assert edge["forward"], "Child must appear to the right of its parent"
      assert edge["marker"]
    end
  end

  test "library controls stay usable on narrow screens and search supports keyboard navigation" do
    Presentation.delete_all
    Presentations::LineageSampleData.load!
    visit presentations_path
    assert_selector ".lineage-node", count: 15

    [1400, 780, 390].each do |width|
      page.driver.browser.manage.window.resize_to(width, 1000)
      assert_operator page.evaluate_script("document.documentElement.scrollWidth"), :<=,
        page.evaluate_script("window.innerWidth")
      find('.lineage-navigation').scroll_to(:center)
      assert_selector 'button[aria-label="Zoom out"]', visible: true
      find('button[aria-label="Zoom out"]').click
      assert_selector '[data-lineage-graph-target="scaleLabel"]', text: "85%"
      find('button[aria-label="Reset graph view"]').click
      assert_timeline_geometry
      save_screenshot("tmp/screenshots/library/viewport-#{width}.png")
    end

    search = find('input[aria-label="Find a presentation"]')
    search.set("Quarterly Review June")
    search.send_keys(:arrow_down)
    assert_equal "Quarterly Review June · 2026-01-08", page.evaluate_script("document.activeElement.textContent")
    save_screenshot("tmp/screenshots/library/search-mobile.png")
    send_keys :escape
    assert_selector '.lineage-search-results', visible: :hidden
    assert_equal "Find a presentation", page.evaluate_script("document.activeElement.getAttribute('aria-label')")
    search.set("No such presentation")
    assert_text "No matching presentations."
    search.set("Quarterly Review June")
    search.send_keys(:arrow_down, :enter)
    assert_selector ".lineage-node.is-located"
    page.execute_script("document.querySelector('.lineage-node.is-located').scrollIntoView({block: 'center'})")
    save_screenshot("tmp/screenshots/library/focus-mobile.png")

    within("article", match: :first) do
      find('summary', text: "Rename").click
      assert_selector '.library-rename input[type="text"]', visible: true
      page.execute_script("document.querySelector('.rename-menu[open]').scrollIntoView({block: 'center'})")
      save_screenshot("tmp/screenshots/library/rename-mobile.png")
      find('summary', text: "Rename").click
      find('summary', text: "Fork").click
      assert_selector 'button', text: "As inspiration", visible: true
      page.execute_script("document.querySelector('.fork-menu[open]').scrollIntoView({block: 'center'})")
      save_screenshot("tmp/screenshots/library/fork-mobile.png")
    end
    assert_operator page.evaluate_script("document.documentElement.scrollWidth"), :<=,
      page.evaluate_script("window.innerWidth")
  ensure
    page.driver.browser.manage.window.resize_to(1400, 1000)
  end

  test "loads sample presentations from the library" do
    Presentation.delete_all

    visit presentations_path
    assert_text "No presentations yet"
    save_screenshot("tmp/screenshots/library/empty.png")
    find("summary", text: "More").click
    click_on "Load sample presentations"

    assert_text "Sample presentations loaded."
    Presentations::SampleData::SAMPLES.each do |sample|
      assert_text sample[:title]
    end
    Presentations::LineageSampleData::SAMPLES.each do |sample|
      assert_text sample[:title]
    end
  end

  test "shows the seeded lineage tree in the library" do
    Presentation.delete_all
    Presentations::LineageSampleData.load!

    visit presentations_path

    assert_selector ".lineage-graph .lineage-node", count: 15
    assert_selector ".lineage-continuation"
    assert_selector ".lineage-inspiration"
    assert_equal 12, page.evaluate_script("document.querySelectorAll('.lineage-edge').length")
    assert_equal 15, page.evaluate_script("document.querySelectorAll('.lineage-node[data-lineage-graph-created-at]').length")
    assert_equal 3, page.evaluate_script("document.querySelectorAll('.lineage-date-tick').length")
    assert_equal 0, page.evaluate_script("document.querySelectorAll('.lineage-node[data-dragged]').length")
    assert_timeline_geometry
    find('button[aria-label="Zoom out"]').click
    assert_timeline_geometry
    click_on "Overview"
    assert_timeline_geometry
    find('button[aria-label="Reset graph view"]').click
    page.driver.browser.manage.window.resize_to(780, 900)
    find('select[aria-label="Jump to creation date"] option[value="2026-01-15"]').select_option
    assert_operator page.evaluate_script("document.querySelector('.lineage-timeline-scroll').scrollLeft"), :>, 0
    assert_timeline_geometry
    page.driver.browser.manage.window.resize_to(1400, 1000)
    find('input[aria-label="Find a presentation"]').set("Quarterly Review June")
    within(".lineage-search-results") { find("button", text: "Quarterly Review June").click }
    assert_selector ".lineage-node.is-located"
    find('a[aria-label="Open Quarterly Review June"]').click
    assert_field "Markdown source", with: /Quarterly Review June/
  end

  test "navigates a large same-day timeline without overlapping slides" do
    Presentation.delete_all
    created = Time.utc(2026, 9, 1, 10)
    12.times do |family|
      parent = Presentation.create!(title: "Family #{family}", source: "# Family #{family}", created_at: created)
      5.times do |generation|
        child = parent.fork_as("continuation")
        child.title = "Family #{family} revision #{generation}"
        child.created_at = created
        child.save!
        if generation == 2
          inspiration = parent.fork_as("inspiration")
          inspiration.title = "Family #{family} workshop"
          inspiration.created_at = created
          inspiration.save!
        end
        parent = child
      end
    end
    visit presentations_path
    assert_selector ".lineage-node", count: 84
    assert_selector ".lineage-date-tick", count: 1
    assert_timeline_geometry
    find('input[aria-label="Find a presentation"]').set("Family 11 revision 4")
    find(".lineage-search-results button", text: "Family 11 revision 4").click
    assert_selector ".lineage-node.is-located"
    page.driver.browser.manage.window.resize_to(780, 900)
    assert_timeline_geometry
    find('a[aria-label="Open Family 11 revision 4"]').click
    assert_field "Title", with: "Family 11 revision 4"
  ensure
    page.driver.browser.manage.window.resize_to(1400, 1000)
  end

  test "preserves a 16:9 slide surface across views" do
    parent = Presentation.create!(title: "Ratio deck", source: "# First slide\n\nContent\n---\n# Second slide")
    child = parent.fork_as("continuation")
    child.save!

    visit presentation_path(parent)
    assert_selector '.slides .slide', count: 2
    preview_ratio = page.evaluate_script("(function(){ const r = document.querySelector('.slides .slide').getBoundingClientRect(); return r.width / r.height })()")

    visit present_presentation_path(parent)
    assert_selector '.presentation-slide.slide', visible: true
    presentation_ratio = page.evaluate_script("(function(){ const r = document.querySelector('.presentation-slide.slide').getBoundingClientRect(); return r.width / r.height })()")

    visit presentations_path
    assert_selector ".lineage-node[data-lineage-graph-id='#{parent.id}'] .slide"
    lineage_ratio = page.evaluate_script("(function(){ const r = document.querySelector(\"[data-lineage-graph-id='#{parent.id}'] .slide\").getBoundingClientRect(); return r.width / r.height })()")

    assert_in_delta 16.0 / 9.0, preview_ratio, 0.02
    assert_in_delta preview_ratio, presentation_ratio, 0.02
    assert_in_delta preview_ratio, lineage_ratio, 0.02
  end

  test "renders the code and math sample with block display math" do
    Presentations::SampleData.load!

    visit presentations_path
    within("article", text: "Sample: Code and LaTeX math") do
      click_on "Preview"
    end

    assert_current_path %r{/presentations/\d+}, wait: 5
    assert_selector ".presentation-surface .slide", visible: true, wait: 5
    assert_selector ".katex", count: 4, visible: true
    assert_selector ".katex-display", visible: true
    assert_selector ".katex-html", visible: true
    assert_selector ".mfrac .frac-line", visible: true
    assert_selector ".msupsub", visible: true
    assert_text "$not_math$"
    assert_no_selector ".math-error"
    assert_equal "block",
      page.evaluate_script("getComputedStyle(document.querySelector('.katex-display')).display")
    assert_equal "absolute",
      page.evaluate_script("getComputedStyle(document.querySelector('.katex-mathml')).position")
    fraction_parts = page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll(".mfrac > .vlist-t > .vlist-r:first-child > .vlist > span > .mord")].map((element) => {
        const rect = element.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom };
      })
    JAVASCRIPT
    assert_operator fraction_parts.length, :>=, 2
    assert_operator (fraction_parts[1]["top"] - fraction_parts[0]["top"]).abs, :>, 1
  end

  test "renders automatic layouts and positioned blocks" do
    presentation = Presentation.create!(
      title: "Automatic layouts",
      source: <<~MARKDOWN
        # Compare

        ## Left

        One side.

        ## Right

        The other side.
        ---
        # Positioned

        :::position{center middle}

        Center this message.
      MARKDOWN
    )

    visit presentation_path(presentation)

    assert_selector ".slide-two-column .slide-regions"
    assert_selector ".slide-statement .position-center.position-middle", text: /Center this message/
    refute_text ":::position"
  end

  test "keeps Elef UI and presentation surfaces as separate styling zones" do
    presentation = Presentation.create!(title: "Scoped Deck", source: "# Scoped\n\n- One\n- Two")

    visit presentations_path
    assert_selector "body.elef-app"
    refute_selector "body.presentation-body"

    visit presentation_path(presentation)
    assert_selector "body.elef-app"
    assert_selector ".presentation-surface"
    assert_equal "disc",
      page.evaluate_script("getComputedStyle(document.querySelector('.presentation-surface ul')).listStyleType")

    visit present_presentation_path(presentation)
    assert_selector "body.presentation-body"
    assert_selector ".presentation-mode.presentation-surface"
    refute_selector "body.elef-app"
  end

  test "starts every regular slide header at the same inset" do
    presentation = Presentation.create!(
      title: "Header alignment",
      source: "# Short slide\n\nA short body.\n---\n# Code-heavy slide\n\n```ruby\n#{'  ' * 2}records.each { |record| process(record) }\n#{'  ' * 2}records.each { |record| process(record) }\n```\n\nAdditional body content."
    )

    visit presentation_path(presentation)

    header_offsets = page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll(".slide")].map((slide) => {
        const header = slide.querySelector("h1");
        const slideRect = slide.getBoundingClientRect();
        const headerRect = header.getBoundingClientRect();
        return headerRect.top - slideRect.top;
      })
    JAVASCRIPT

    assert_equal 2, header_offsets.length
    assert_in_delta header_offsets.first, header_offsets.last, 0.001
  end

  test "user creates saves and reopens a markdown presentation" do
    visit presentations_path
    find("summary", text: "New").click
    assert_equal "pointer", page.evaluate_script("getComputedStyle(document.querySelector('.new-work-trigger')).cursor")
    assert_equal "pointer", page.evaluate_script("getComputedStyle(document.querySelector('.new-work-option')).cursor")
    assert_equal "pointer", page.evaluate_script("getComputedStyle(document.querySelector('.library-tools > summary')).cursor")
    within ".new-work-panel" do
      click_on "Presentation"
    end

    fill_in "Title", with: "System Deck"
    source = "# First\n\nBody\n---\n# Second"
    select "Book", from: "Typography"
    normalized_source = "---\ntypography: book\n---\n#{source}"
    fill_in "Markdown source", with: source
    click_on "Save presentation"

    assert_current_path %r{/presentations/\d+/edit}
    assert_text "Presentation saved."
    assert_field "Markdown source", with: normalized_source
    assert_selector ".slide", count: 2

    click_on "Library"
    click_on "System Deck"
    assert_field "Markdown source", with: normalized_source
  end

  test "presenting warns before leaving unsaved edits" do
    presentation = Presentation.create!(title: "Guarded presentation", source: "# Saved source")

    visit edit_presentation_path(presentation)
    hold_autosaves
    fill_in "Markdown source", with: "# Unsaved source"
    dismiss_confirm { click_on "Present" }

    assert_current_path edit_presentation_path(presentation)
    assert_field "Markdown source", with: "# Unsaved source"

    accept_confirm { click_on "Present" }
    assert_current_path present_presentation_path(presentation)
    assert_selector ".presentation-slide", text: "Saved source"
    assert_no_selector ".presentation-slide", text: "Unsaved source"
  end

  test "dirty source warns before navigation and cancel preserves edits" do
    presentation = Presentation.create!(title: "Dirty Deck", source: "# Saved")

    visit edit_presentation_path(presentation)
    hold_autosaves
    fill_in "Markdown source", with: "# Unsaved"

    dismiss_confirm do
      click_on "Library"
    end

    assert_current_path edit_presentation_path(presentation)
    assert_field "Markdown source", with: "# Unsaved"
  end

  test "presentation mode advances with keyboard" do
    presentation = Presentation.create!(title: "Presenter", source: "# One\n---\n# Two")

    visit present_presentation_path(presentation)
    assert_text "1 / 2"
    assert_selector ".presentation-slide", text: "One", visible: :visible

    send_keys :arrow_right
    assert_text "2 / 2"
    assert_selector ".presentation-slide", text: "Two", visible: :visible

    send_keys :arrow_left
    assert_text "1 / 2"
  end

  test "presentation keyboard shortcuts do not hijack toolbar activation" do
    presentation = Presentation.create!(title: "Keyboard exit", source: "# One")

    visit present_presentation_path(presentation)
    find("a", text: "Exit").send_keys(:enter)

    assert_current_path presentation_path(presentation)
  end

  test "inserts a fuzzy snippet and moves through its placeholder" do
    Snippet.create!(name: "Block equation", trigger: "beq", description: "A block LaTeX equation", category: "LaTeX", body: "$$\n${1:equation}\n$$")
    presentation = Presentation.create!(title: "Snippet deck", source: "# Math\n\n:")

    visit edit_presentation_path(presentation)
    source = find_field("Markdown source")
    source.send_keys("beq")
    assert_selector ".snippet-palette", visible: true
    assert_text ":beq"
    assert_selector ".snippet-option[aria-selected='true']"
    assert_equal "true", page.evaluate_script("document.querySelector('.cm-editor').getAttribute('aria-expanded')")
    palette_position = page.evaluate_script("(() => { const editor = document.querySelector('[data-snippet-palette-target=editor]'); const e = editor.getBoundingClientRect(); const p = document.querySelector('[data-snippet-palette-target=palette]').getBoundingClientRect(); const styles = getComputedStyle(editor); const lineHeight = parseFloat(styles.lineHeight); const paddingTop = parseFloat(styles.paddingTop); const lineNumber = editor.value.slice(0, editor.selectionStart).split('\\n').length; const caretLineBottom = e.top + paddingTop + lineHeight * lineNumber - editor.scrollTop; return { paletteTop: p.top, paletteBottom: p.bottom, caretLineBottom, viewportBottom: window.innerHeight }; })()")
    assert_operator palette_position["paletteTop"], :>, palette_position["caretLineBottom"]
    assert_operator palette_position["paletteBottom"], :<, palette_position["viewportBottom"]

    source.send_keys(:enter)
    assert_equal "# Math\n\n$$\nequation\n$$", source.value
    assert_equal "equation", page.evaluate_script("(() => { const e = document.querySelector('[data-snippet-palette-target=editor]'); return e.value.slice(e.selectionStart, e.selectionEnd) })()")
  end

  test "keeps multiple snippet placeholders aligned while tabbing" do
    Snippet.create!(name: "Two fields", trigger: "twice", description: "Two tab stops", category: "Markdown", body: "A ${1:first} B ${2:second}")
    presentation = Presentation.create!(title: "Multiple stops", source: "# Snippets\n\n:")

    visit edit_presentation_path(presentation)
    source = find_field("Markdown source")
    source.send_keys("twice")
    source.send_keys(:enter)

    selected_text = "(() => { const e = document.querySelector('[data-snippet-palette-target=editor]'); return e.value.slice(e.selectionStart, e.selectionEnd) })()"
    assert_equal "first", page.evaluate_script(selected_text)
    find(".cm-content").send_keys(:tab)
    assert_equal "second", page.evaluate_script(selected_text)
  end

  test "positions the palette when only the colon trigger is typed" do
    Snippet.create!(name: "Equation", trigger: "beq", category: "LaTeX", body: "x")
    visit new_presentation_path
    source = find_field("Markdown source")
    source.fill_in with: "# Math\n\n"
    source.send_keys(":")
    assert_selector ".snippet-option", text: ":beq"
    bounds = page.evaluate_script(<<~JS)
      (() => {
        const editor = document.querySelector('[data-snippet-palette-target="editor"]');
        const palette = document.querySelector('.snippet-palette');
        const e = editor.getBoundingClientRect(), p = palette.getBoundingClientRect();
        return { positioned: palette.style.top !== '', top: p.top, bottom: p.bottom, editorTop: e.top, viewportBottom: window.innerHeight };
      })()
    JS
    assert bounds["positioned"], "The colon popup must receive caret coordinates before a query is typed"
    assert_operator bounds["top"], :>, bounds["editorTop"]
    assert_operator bounds["bottom"], :<, bounds["viewportBottom"]
    save_screenshot("tmp/colon-palette.png")
  end

  test "renders untrusted snippet metadata as text" do
    Snippet.create!(name: '<img src=x onerror="alert(1)">', trigger: "unsafe", description: "Untrusted", category: "Markdown", body: "text")
    presentation = Presentation.create!(title: "Safe snippets", source: "# Safe\n\n:")

    visit edit_presentation_path(presentation)
    source = find_field("Markdown source")
    source.send_keys("unsafe")

    assert_selector ".snippet-option span", text: '<img src=x onerror="alert(1)"> · Markdown'
    assert_no_selector ".snippet-option img"
  end

  test "keeps slide geometry fixed while scaling the canvas" do
    presentation = Presentation.create!(
      title: "Static geometry",
      source: "# A fixed heading\n\nA paragraph with enough content to establish a stable line break in the design canvas."
    )

    visit presentation_path(presentation)

    geometry = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const frame = document.querySelector('.slide-frame');
        const slide = frame.querySelector('.slide');
        const heading = slide.querySelector('h1');
        return {
          frameRatio: frame.getBoundingClientRect().width / frame.getBoundingClientRect().height,
          slideWidth: slide.offsetWidth,
          slideHeight: slide.offsetHeight,
          headingFontSize: getComputedStyle(heading).fontSize,
          scale: Number.parseFloat(getComputedStyle(slide).getPropertyValue('--slide-scale'))
        };
      })()
    JAVASCRIPT

    assert_in_delta 16.0 / 9, geometry["frameRatio"], 0.01
    assert_equal 1280, geometry["slideWidth"]
    assert_equal 720, geometry["slideHeight"]
    assert_equal "112px", geometry["headingFontSize"]
    assert_operator geometry["scale"], :>, 0

    page.execute_script("document.querySelector('.slide-frame').style.width = '640px'")
    page.evaluate_async_script("window.requestAnimationFrame(() => arguments[0]())")
    resized_scale = page.evaluate_script("Number.parseFloat(getComputedStyle(document.querySelector('.slide')).getPropertyValue('--slide-scale'))")

    assert_operator resized_scale, :<, geometry["scale"]
    assert_equal 1280, page.evaluate_script("document.querySelector('.slide').offsetWidth")
    assert_equal 720, page.evaluate_script("document.querySelector('.slide').offsetHeight")
    assert_equal "112px", page.evaluate_script("getComputedStyle(document.querySelector('.slide h1')).fontSize")
  end
end
