require "application_system_test_case"

class ArtTest < ApplicationSystemTestCase
  def wait_for_art_settled
    return if has_selector?(".presentation-surface[data-controller~='art-layout'] [data-elef-art-root][data-art-settled='true']", wait: 10)

    state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const controllerElement = document.querySelector('.presentation-surface[data-controller~="art-layout"]');
        const controller = controllerElement && window.Stimulus?.getControllerForElementAndIdentifier(controllerElement, "art-layout");
        return {
          roots: [...(controllerElement?.querySelectorAll("[data-elef-art-root]") || [])].map((root) => {
            const host = root.closest('[data-art-host="fixed"]');
            const list = root.querySelector(".elef-art-list");
            return { mode: root.dataset.artMode, density: root.dataset.artDensity, status: root.dataset.artStatus, layout: root.dataset.artLayout, settled: root.dataset.artSettled, root: [root.scrollWidth, root.clientWidth, root.scrollHeight, root.clientHeight], host: host && [host.scrollWidth, host.clientWidth, host.scrollHeight, host.clientHeight], items: [...(list?.children || [])].map((item) => [item.scrollWidth, item.clientWidth, item.scrollHeight, item.clientHeight]) };
          }),
          active: Boolean(controller),
          controllerRootCount: controller?.roots?.length ?? null,
          frame: controller?.frame ?? null,
          readFrame: controller?.readFrame ?? null
        };
      })()
    JAVASCRIPT
    flunk "Art roots did not settle: #{state.inspect}"
  end

  def paginate_with_item_limit(limit)
      forced_state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
      const limit = #{Integer(limit)};
      const surface = document.querySelector(".document-editor-projection [data-document-pages-target='surface']");
      const firstContent = surface.querySelector(".document-page-content");
      const initialFragments = [...surface.querySelectorAll(".document-page-frame")].map((frame) => {
        const list = frame.querySelector(".elef-art-list");
        return list ? { start: list.hasAttribute("start") ? list.getAttribute("start") : null, items: [...list.children].map((item) => item.textContent.trim()) } : null;
      }).filter(Boolean);
      const root = firstContent.querySelector("[data-elef-art-root]");
      const block = root.closest(".document-editor-block-shell");
      const list = block.querySelector(".elef-art-list");
      const firstPageProbe = block.cloneNode(true);
      firstPageProbe.querySelector(".elef-art-list").replaceChildren(...[...list.children].slice(0, limit).map((item) => item.cloneNode(true)));
      firstPageProbe.style.position = "absolute";
      firstPageProbe.style.visibility = "hidden";
      firstPageProbe.style.width = `${block.offsetWidth}px`;
      firstContent.append(firstPageProbe);
      const firstPageHeight = firstPageProbe.offsetHeight + 1;
      firstPageProbe.remove();
      const style = document.createElement("style");
      style.id = "art-test-page-height";
      style.textContent = `.document-surface.is-paginated > .document-page-frame .document-page-content { flex: 0 0 282px !important; height: 282px !important; } .document-surface.is-paginated > .document-page-frame:first-child .document-page-content { flex: 0 0 ${firstPageHeight}px !important; height: ${firstPageHeight}px !important; }`;
      document.head.append(style);
      const reader = document.querySelector(".document-editor-projection");
      const controller = window.Stimulus.getControllerForElementAndIdentifier(reader, "document-pages");
      controller.paginate();
      return { firstPageHeight, initialFragments };
      })()
    JAVASCRIPT
    assert_selector ".document-surface[data-document-pages-settled='true']", wait: 10
    forced_state
  end

  test "compact fixed Sequence uses the canonical width rule and the containment oracle" do
    presentation = Presentation.create!(
      title: "Art horizontal Sequence",
      source: "# Launch workflow\n\n:::art\n1. Discover\n2. Design\n3. Build\n4. Launch"
    )

    visit edit_presentation_path(presentation)
    wait_for_art_settled
    data = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const root = document.querySelector(".presentation-surface[data-controller~='art-layout'] [data-elef-art-root]");
        const host = root.closest('[data-art-host="fixed"]');
        const gap = parseFloat(getComputedStyle(root).getPropertyValue("--art-gap"));
        const minimum = parseFloat(getComputedStyle(root).getPropertyValue("--art-sequence-min-inline"));
        let left = 0;
        let top = 0;
        let node = root;
        while (node && node !== host) {
          left += node.offsetLeft;
          top += node.offsetTop;
          node = node.offsetParent;
        }
        const items = [...root.querySelector(".elef-art-list").children];
        const contains = (element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1;
        return {
          mode: root.dataset.artMode,
          density: root.dataset.artDensity,
          layout: root.dataset.artLayout,
          status: root.dataset.artStatus,
          width: host.clientWidth,
          height: host.clientHeight,
          rootScrollWidth: root.scrollWidth,
          rootClientWidth: root.clientWidth,
          rootScrollHeight: root.scrollHeight,
          rootClientHeight: root.clientHeight,
          hostScrollWidth: host.scrollWidth,
          hostScrollHeight: host.scrollHeight,
          itemGeometry: items.map((item) => ({clientWidth: item.clientWidth, scrollWidth: item.scrollWidth, clientHeight: item.clientHeight, scrollHeight: item.scrollHeight})),
          eligible: (host.clientWidth - gap * (items.length - 1)) / items.length >= minimum,
          containment: contains(host) && contains(root) && items.every(contains) && node === host && left + root.offsetWidth <= host.clientWidth + 1 && top + root.offsetHeight <= host.clientHeight + 1
        };
      })()
    JAVASCRIPT

    assert_equal "sequence", data.fetch("mode")
    assert_equal "compact", data.fetch("density")
    assert_in_delta 1120, data.fetch("width"), 2
    assert_operator data.fetch("height"), :>, 0
    assert data.fetch("eligible"), "the host must satisfy the formula before expecting horizontal Sequence"
    assert_equal "sequence-horizontal", data.fetch("layout"), data.inspect
    assert_equal "ready", data.fetch("status")
    assert data.fetch("containment"), "ready Art must pass the whole-host containment oracle"
  end

  test "forced Art pagination splits at direct items and resumes ordered starts including zero" do
    [
      [3, 6, 5],
      [0, 4, 2]
    ].each do |start, count, expected_start|
      markers = (start...(start + count)).map { |number| "#{number}. Item #{number}" }
      document = Document.create!(title: "Art pagination #{start}", source: ":::art\n#{markers.join("\n")}")
      visit edit_document_path(document)
      assert_selector ".document-editor-projection [data-elef-art-root]", wait: 10
      initial = paginate_with_item_limit(2)

      fragments = page.evaluate_script(<<~JAVASCRIPT)
        [...document.querySelectorAll(".document-page-frame")].map((frame) => {
          const list = frame.querySelector(".elef-art-list");
          const content = frame.querySelector(".document-page-content");
          return list ? { count: list.children.length, connectors: [...list.children].map((item) => getComputedStyle(item, "::before").content), start: list.hasAttribute("start") ? Number(list.getAttribute("start")) : 1, clientHeight: content.clientHeight, scrollHeight: content.scrollHeight, blocks: [...content.children].map((block) => ({height: block.offsetHeight, styleHeight: block.style.height, text: block.textContent.slice(0, 40)})) } : null;
        }).filter(Boolean)
      JAVASCRIPT
      assert_equal [2, count - 2], fragments.map { |fragment| fragment.fetch("count") }, { initial: initial, fragments: fragments }.inspect
      assert_equal [start, expected_start], fragments.map { |fragment| fragment.fetch("start") }
      fragments.each do |fragment|
        assert_equal "none", fragment.fetch("connectors").first, fragment.inspect
        assert fragment.fetch("connectors").drop(1).all? { |connector| connector != "none" }, fragment.inspect
      end

      page.execute_script("window.Stimulus.getControllerForElementAndIdentifier(document.querySelector('.document-editor-projection'), 'document-pages').paginate()")
      assert_selector ".document-surface[data-document-pages-settled='true']", wait: 10
      repeated = page.evaluate_script(<<~JAVASCRIPT)
        [...document.querySelectorAll(".document-page-frame .elef-art-list")].map((list) => [list.children.length, list.hasAttribute("start") ? Number(list.getAttribute("start")) : 1])
      JAVASCRIPT
      assert_equal fragments.map { |fragment| [fragment.fetch("count"), fragment.fetch("start")] }, repeated
    end
  end

  test "a one-item Sequence has no connector" do
    document = Document.create!(title: "Single Art item", source: ":::art\n1. One step")
    visit edit_document_path(document)
    assert_selector ".document-editor-projection [data-elef-art-root]", wait: 10

    connector = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const item = document.querySelector(".document-editor-projection [data-elef-art-root] .elef-art-list > li");
        return getComputedStyle(item, "::before").content;
      })()
    JAVASCRIPT
    assert_equal "none", connector
  end

  test "a single oversized Art item stays atomic and surfaces its diagnostic" do
    lead = "This one authored item must stay intact. " * 700
    document = Document.create!(title: "Oversized Art item", source: ":::art\n1. #{lead}")

    visit edit_document_path(document)
    assert_selector ".document-editor-projection [data-elef-art-root]", wait: 10
    page.evaluate_script("window.Stimulus.getControllerForElementAndIdentifier(document.querySelector('.document-editor-projection'), 'document-pages').paginate()")
    assert_selector ".document-surface[data-document-pages-settled='true']", wait: 10

    assert_selector ".document-page.is-overflowing-content [data-elef-art-root][data-art-diagnostic='ART_ITEM_TOO_TALL']"
    assert_equal 1, page.all(".document-page .elef-art-list > li").length
    assert_includes page.find(".document-page .elef-art-list > li").text, "This one authored item must stay intact."
    assert_selector ".preview-warnings li", text: /taller than a document page/
  end

  test "rich fixed Sequence stays vertical and eight compact items show no-fit" do
    rich = Presentation.create!(
      title: "Art rich Sequence",
      source: "# Implementation roadmap\n\n:::art\n1. Discovery\n   - Interview users\n   - Map the current process\n2. Design\n   - Prioritize constraints\n   - Produce a prototype\n3. Delivery\n   - Build the system\n   - Validate with teams\n4. Adoption\n   - Train users\n   - Measure outcomes"
    )
    visit edit_presentation_path(rich)
    wait_for_art_settled
    assert_selector "[data-elef-art-root][data-art-mode='sequence'][data-art-density='rich']", wait: 10
    rich_state = page.evaluate_script("(() => { const root = document.querySelector('.presentation-surface[data-controller~=\"art-layout\"] [data-elef-art-root]'); const host = root.closest('[data-art-host=\"fixed\"]'); const items = [...root.querySelector('.elef-art-list').children]; let top = 0, left = 0, node = root; while (node && node !== host) { top += node.offsetTop; left += node.offsetLeft; node = node.offsetParent; } const contains = element => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1; return {layout: root.dataset.artLayout, status: root.dataset.artStatus, diagnostic: root.dataset.artDiagnostic || null, offset: [left, top], root: [root.scrollWidth, root.clientWidth, root.scrollHeight, root.clientHeight], host: [host.scrollWidth, host.clientWidth, host.scrollHeight, host.clientHeight], hostChildren: [...host.children].map(child => [child.className, child.offsetTop, child.offsetHeight]), items: items.map((item) => [item.scrollWidth, item.clientWidth, item.scrollHeight, item.clientHeight]), containment: contains(host) && contains(root) && items.every(contains) && node === host && left + root.offsetWidth <= host.clientWidth + 1 && top + root.offsetHeight <= host.clientHeight + 1} })()")
    assert_equal("sequence-vertical", rich_state.fetch("layout"), rich_state.inspect)
    assert_equal("ready", rich_state.fetch("status"), rich_state.inspect)
    assert_nil rich_state.fetch("diagnostic"), rich_state.inspect
    assert_in_delta 1120, rich_state.fetch("host")[1], 2
    assert_in_delta 560, rich_state.fetch("host")[3], 2
    assert rich_state.fetch("containment"), rich_state.inspect

    many = Presentation.create!(title: "Art no-fit", source: "# Hiring pipeline\n\n:::art\n#{(1..8).map { |index| "#{index}. Step #{index}" }.join("\n")}")
    visit edit_presentation_path(many)
    wait_for_art_settled
    art = find(".presentation-surface[data-controller~='art-layout'] [data-elef-art-root]")
    many_geometry = page.evaluate_script("(() => { const root = document.querySelector('.presentation-surface[data-controller~=\"art-layout\"] [data-elef-art-root]'); const host = root.closest('[data-art-host=\"fixed\"]'); let top = 0, node = root; while (node && node !== host) { top += node.offsetTop; node = node.offsetParent; } return {status: root.dataset.artStatus, layout: root.dataset.artLayout, root: [root.scrollHeight, root.clientHeight, root.offsetHeight], host: [host.scrollHeight, host.clientHeight], top, children: [...host.children].map(child => [child.offsetTop, child.offsetHeight])} })()")
    assert_equal "fallback-no-fit", art["data-art-status"], many_geometry.inspect
    assert_equal "ART_NO_FIT", art["data-art-diagnostic"]
    assert_equal 8, art.all(".elef-art-list > li").length
    assert_equal "true", art.find(:xpath, "ancestor::*[@data-art-host='fixed']")["data-art-overfull"]
    assert_selector ".preview-warnings li", text: /does not fit the fixed slide/
  end

  test "canonical document Peers wrap at the preferred basis and remain reflowable in RTL" do
    rich_source = <<~MARKDOWN
      :::art
      - **Speed**
        - Processes files locally
      - **Transparency**
        - Everything remains Markdown
      - **Portability**
        - Same source on web and desktop
      - **Simplicity**
        - No proprietary document format
    MARKDOWN
    document = Document.create!(title: "Rich Art peers", source: rich_source)

    visit edit_document_path(document)
    rich = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const root = document.querySelector(".document-surface [data-elef-art-root]");
        const list = root.querySelector(".elef-art-list");
        const items = [...list.children];
        return {
          mode: root.dataset.artMode,
          density: root.dataset.artDensity,
          status: root.dataset.artStatus,
          layout: root.dataset.artLayout,
          width: root.clientWidth,
          count: items.length,
          rows: [...new Set(items.map((item) => item.offsetTop))].length,
          widths: [...new Set(items.map((item) => item.offsetWidth))],
          nestedListTypes: items.map((item) => item.querySelector(":scope > ul")?.tagName || null)
        };
      })()
    JAVASCRIPT
    assert_equal "peers", rich.fetch("mode")
    assert_equal "rich", rich.fetch("density")
    assert_equal "ready", rich.fetch("status")
    assert_equal "peers-wrap", rich.fetch("layout")
    assert_in_delta 673, rich.fetch("width"), 2
    assert_equal 4, rich.fetch("count")
    assert_equal 2, rich.fetch("rows")
    assert_equal [280], rich.fetch("widths")
    assert_equal ["UL", "UL", "UL", "UL"], rich.fetch("nestedListTypes")

    peer_source = <<~MARKDOWN
      :::art
      - Self-serve onboarding
      - Workflow templates
      - Reusable snippets
      - Better search
      - Presentation themes
      - Review mode
      - Offline-first desktop
    MARKDOWN
    peer_document = Document.create!(title: "Compact Art peers", source: peer_source)
    visit edit_document_path(peer_document)
    compact = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const root = document.querySelector(".document-surface [data-elef-art-root]");
        const list = root.querySelector(".elef-art-list");
        const items = [...list.children];
        const last = items.at(-1);
        const hostWidth = list.clientWidth;
        const rtlBefore = items.map((item) => item.textContent.trim());
        root.dir = "rtl";
        const noHorizontalOverflow = root.scrollWidth <= root.clientWidth && items.every((item) => item.scrollWidth <= item.clientWidth);
        const direction = getComputedStyle(root).direction;
        const centeredLast = Math.abs(last.offsetLeft - (hostWidth - last.offsetWidth) / 2) <= 2;
        const preferredWidths = [...new Set(items.map((item) => item.offsetWidth))];
        return {mode: root.dataset.artMode, density: root.dataset.artDensity, layout: root.dataset.artLayout, width: root.clientWidth, count: items.length, direction, order: items.map((item) => item.textContent.trim()), rtlBefore, centeredLast, preferredWidths, noHorizontalOverflow};
      })()
    JAVASCRIPT
    assert_equal "peers", compact.fetch("mode")
    assert_equal "compact", compact.fetch("density")
    assert_equal "peers-wrap", compact.fetch("layout")
    assert_in_delta 673, compact.fetch("width"), 2
    assert_equal 7, compact.fetch("count")
    assert_equal "rtl", compact.fetch("direction")
    assert_equal compact.fetch("rtlBefore"), compact.fetch("order")
    assert compact.fetch("centeredLast"), compact.inspect
    assert_equal [200], compact.fetch("preferredWidths")
    assert compact.fetch("noHorizontalOverflow"), compact.inspect
  end

  test "inferred two and three column Art hosts use their actual bounded geometry" do
    page.driver.browser.manage.window.resize_to(1600, 1000)
    two_column_source = <<~MARKDOWN
      # Research plan

      ## Goals

      - Understand user needs
      - Validate opportunities
      - Build and test a solution

      ## Delivery

      :::art
      1. Scope
         - Interview users
         - Review landscape
      2. Prototype
         - Wireframes
         - Validate flows
      3. Test
         - Pilot with teams
      4. Ship
         - Rollout and measure
    MARKDOWN
    two_column = Presentation.create!(title: "Two column Art", source: two_column_source)

    visit edit_presentation_path(two_column)
    wait_for_art_settled
    two = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const slide = document.querySelector(".presentation-surface[data-controller~='art-layout'] .slide");
        const root = slide.querySelector("[data-elef-art-root]");
        const host = root.closest('[data-art-host="fixed"]');
        let left = 0, top = 0, node = root;
        while (node && node !== host) { left += node.offsetLeft; top += node.offsetTop; node = node.offsetParent; }
        return {layout: slide.className, width: host.clientWidth, host: [host.scrollWidth, host.clientWidth, host.scrollHeight, host.clientHeight], root: [root.scrollWidth, root.clientWidth, root.scrollHeight, root.clientHeight, root.offsetTop, root.offsetHeight], offsetWithin: [left, top, node === host], mode: root.dataset.artMode, density: root.dataset.artDensity, artLayout: root.dataset.artLayout, status: root.dataset.artStatus, items: [...root.querySelector('.elef-art-list').children].map((item) => [item.scrollWidth, item.clientWidth, item.scrollHeight, item.clientHeight]), children: [...host.children].map((child) => [child.className, child.offsetHeight, child.scrollHeight, child.clientHeight, child.textContent.trim().slice(0, 35)])};
      })()
    JAVASCRIPT
    assert_includes two.fetch("layout"), "slide-two-column"
    assert_in_delta 536, two.fetch("width"), 2
    assert_equal "sequence", two.fetch("mode")
    assert_equal "rich", two.fetch("density")
    assert_equal "sequence-vertical", two.fetch("artLayout")
    assert_equal "ready", two.fetch("status"), two.inspect
    assert_operator two.fetch("host")[0], :<=, two.fetch("host")[1] + 1
    assert_operator two.fetch("host")[2], :<=, two.fetch("host")[3] + 1
    assert_operator two.fetch("root")[0], :<=, two.fetch("root")[1] + 1
    assert_operator two.fetch("root")[2], :<=, two.fetch("root")[3] + 1
    assert_equal true, two.fetch("offsetWithin")[2], two.inspect
    assert_operator two.fetch("offsetWithin")[1] + two.fetch("root")[5], :<=, two.fetch("host")[3] + 1
    assert two.fetch("items").all? { |width, client_width, height, client_height| width <= client_width + 1 && height <= client_height + 1 }, two.inspect

    three_column_source = <<~MARKDOWN
      # Operating model

      ## Inputs

      - Customer needs
      - Market signals

      ## Decisions

      - Prioritize
      - Allocate

      ## Execution

      :::art
      1. Intake
      2. Review
      3. Approve
      4. Execute
      5. Audit
    MARKDOWN
    three_column = Presentation.create!(title: "Three column Art", source: three_column_source)
    visit edit_presentation_path(three_column)
    wait_for_art_settled
    three = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const slide = document.querySelector(".presentation-surface[data-controller~='art-layout'] .slide");
        const root = slide.querySelector("[data-elef-art-root]");
        const host = root.closest('[data-art-host="fixed"]');
        const items = [...root.querySelector('.elef-art-list').children];
        let left = 0, top = 0, node = root;
        while (node && node !== host) { left += node.offsetLeft; top += node.offsetTop; node = node.offsetParent; }
        return {layout: slide.className, width: host.clientWidth, host: [host.scrollWidth, host.clientWidth, host.scrollHeight, host.clientHeight], root: [root.scrollWidth, root.clientWidth, root.scrollHeight, root.clientHeight, root.offsetTop, root.offsetHeight], offsetWithin: [left, top, node === host], items: items.map((item) => [item.scrollWidth, item.clientWidth, item.scrollHeight, item.clientHeight]), mode: root.dataset.artMode, density: root.dataset.artDensity, artLayout: root.dataset.artLayout, status: root.dataset.artStatus};
      })()
    JAVASCRIPT
    assert_includes three.fetch("layout"), "slide-three-column"
    assert_in_delta 341, three.fetch("width"), 2
    assert_equal "sequence", three.fetch("mode")
    assert_equal "compact", three.fetch("density")
    assert_equal "sequence-vertical", three.fetch("artLayout")
    assert_equal "ready", three.fetch("status"), three.inspect
    assert_operator three.fetch("host")[0], :<=, three.fetch("host")[1] + 1
    assert_operator three.fetch("host")[2], :<=, three.fetch("host")[3] + 1
    assert_operator three.fetch("root")[0], :<=, three.fetch("root")[1] + 1
    assert_operator three.fetch("root")[2], :<=, three.fetch("root")[3] + 1
    assert_equal true, three.fetch("offsetWithin")[2], three.inspect
    assert_operator three.fetch("offsetWithin")[1] + three.fetch("root")[5], :<=, three.fetch("host")[3] + 1
    assert three.fetch("items").all? { |width, client_width, height, client_height| width <= client_width + 1 && height <= client_height + 1 }, three.inspect
  end

  test "ART-SRC-008 position modifiers stay on an Art block in Rails presentation rendering" do
    presentation = Presentation.create!(
      title: "Positioned Art",
      source: "# Positioned Art\n\n## Context\n\n- One input\n\n## Art block\n\n:::position{middle right}\n:::art\n- Alpha\n- Beta"
    )

    visit present_presentation_path(presentation)

    assert_selector ".slide-region[data-art-host='fixed'] > .slide-middle-group > .slide-block-item > .slide-region-block.position-right.position-middle > .slide-block.position-right.position-middle [data-elef-art-root][data-art-mode='peers']", wait: 10
  end

  test "grouped Art controls stay anchored across Rails and JavaScript renderers" do
    source = ["# Deck", *%w[left center right].map do |horizontal|
      title = horizontal.titleize
      [
        "## #{title}",
        ":::align{middle #{horizontal}}\n:::art\n- Stack #{horizontal}",
        "x",
        ":::align{bottom #{horizontal}}\n:::art\n- Footer #{horizontal}"
      ].join("\n\n")
    end].join("\n\n")
    presentation = Presentation.create!(title: "Grouped Art controls", source: source)

    visit edit_presentation_path(presentation)
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])", wait: 10
    wait_for_art_settled

    javascript_geometry = grouped_art_control_geometry
    assert_grouped_art_control_geometry(javascript_geometry)
    first_art_index = javascript_geometry.first.fetch("blockIndex")
    first_footer_index = javascript_geometry[1].fetch("blockIndex")

    editor_map = Source::Document.editor_map(source, source_name: presentation.title, mode: :presentation)
    rails_html = PresentationsController.renderer.render(
      partial: "presentations/slides",
      locals: { presentation: presentation, editable: true, editor_map: editor_map }
    )
    rails_geometry = page.evaluate_script(<<~JAVASCRIPT, rails_html)
      (() => {
        const staging = document.createElement("div");
        staging.innerHTML = arguments[0];
        const surface = staging.firstElementChild;
        surface.style.cssText = "position:fixed;left:0;top:0;width:1280px;height:720px;z-index:99999;pointer-events:none";
        document.body.append(surface);
        const result = [...surface.querySelectorAll(".slide-region-block")].filter((region) => region.querySelector("[data-elef-art-root]")).map((region) => {
          const controls = region.querySelector(":scope > .presentation-editor-block-controls");
          const select = controls?.querySelector("select[data-presentation-editor-align]");
          const regionRect = region.getBoundingClientRect();
          const controlsRect = controls?.getBoundingClientRect();
          return {
            classes: region.className.split(/\\s+/).filter(name => name.startsWith("position-")),
            controlsDirect: controls?.parentElement === region,
            relative: getComputedStyle(region).position === "relative",
            absoluteControls: controls && getComputedStyle(controls).position === "absolute",
            topOffset: controlsRect ? Math.abs(controlsRect.top - regionRect.top) : null,
            rightOffset: controlsRect ? Math.abs(regionRect.right - controlsRect.right) : null,
            blockIndex: select?.dataset.blockIndex ?? null,
            blockId: region.querySelector(":scope > .slide-block")?.dataset.editorBlockId ?? null
          };
        });
        surface.remove();
        return result;
      })()
    JAVASCRIPT
    assert_grouped_art_control_geometry(rails_geometry)

    first(".presentation-surface.presentation-editor-projection [data-elef-art-root]").hover
    hover_state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const root = document.querySelector(".presentation-surface.presentation-editor-projection [data-elef-art-root]");
        const region = root?.closest(".slide-region-block");
        const controls = region?.querySelector(":scope > .presentation-editor-block-controls");
        return { hover: region?.matches(":hover"), opacity: controls && getComputedStyle(controls).opacity, pointerEvents: controls && getComputedStyle(controls).pointerEvents };
      })()
    JAVASCRIPT
    assert_equal true, hover_state.fetch("hover"), hover_state.inspect
    assert_equal "1", hover_state.fetch("opacity"), hover_state.inspect
    assert_equal "auto", hover_state.fetch("pointerEvents"), hover_state.inspect
    first_alignment = first("select[data-presentation-editor-align][data-slide-index='0'][data-block-index='#{first_art_index}']")
    first_alignment.select("Middle Right")
    assert_field "Markdown source", with: /:::align\{middle right\}/, wait: 5
    assert_equal "middle right", first("select[data-presentation-editor-align][data-slide-index='0'][data-block-index='#{first_art_index}']", visible: :all)["value"]
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])", wait: 10

    all(".slide-region[data-art-host='fixed'] [data-elef-art-root]")[1].hover
    first_footer_alignment = first("select[data-presentation-editor-align][data-slide-index='0'][data-block-index='#{first_footer_index}']")
    first_footer_alignment.select("Bottom Center")
    assert_field "Markdown source", with: /:::align\{bottom center\}/, wait: 5
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 10

    visit edit_presentation_path(presentation)
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])", wait: 10
    assert_field "Markdown source", with: /:::align\{middle right\}/
    assert_field "Markdown source", with: /:::align\{bottom center\}/
    assert_equal "middle right", first("select[data-presentation-editor-align][data-slide-index='0'][data-block-index='#{first_art_index}']", visible: :all)["value"]
    assert_equal "bottom center", first("select[data-presentation-editor-align][data-slide-index='0'][data-block-index='#{first_footer_index}']", visible: :all)["value"]
    first_art_block_id = javascript_geometry.first.fetch("blockId")
    first_footer_block_id = javascript_geometry[1].fetch("blockId")
    assert_includes find(".slide-block[data-editor-block-id='#{first_art_block_id}']")["class"], "position-right"
    assert_includes find(".slide-block[data-editor-block-id='#{first_footer_block_id}']")["class"], "position-center"
  end

  test "titleless body Art controls stay anchored in middle stacks and bottom lanes" do
    source = [
      ":::align{middle left}\n:::art\n- Middle Art",
      ":::align{center}\nMiddle follower",
      ":::align{bottom right}\n:::art\n- Bottom Art",
      ":::align{bottom center}\nFooter"
    ].join("\n\n")
    presentation = Presentation.create!(title: "Titleless grouped Art", source: source)

    visit edit_presentation_path(presentation)
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])", wait: 10
    wait_for_art_settled

    javascript_geometry = body_grouped_art_control_geometry(".presentation-surface.presentation-editor-projection")
    assert_body_grouped_art_control_geometry(javascript_geometry)

    editor_map = Source::Document.editor_map(source, source_name: presentation.title, mode: :presentation)
    rails_html = PresentationsController.renderer.render(
      partial: "presentations/slides",
      locals: { presentation: presentation, editable: true, editor_map: editor_map }
    )
    rails_geometry = page.evaluate_script(<<~JAVASCRIPT, rails_html)
      (() => {
        const staging = document.createElement("div");
        staging.innerHTML = arguments[0];
        const surface = staging.firstElementChild;
        surface.style.cssText = "position:fixed;left:0;top:0;width:1280px;height:720px;z-index:99999;pointer-events:none";
        document.body.append(surface);
        const result = [...surface.querySelectorAll(".slide-middle-group > .slide-block-item > .slide-region-block, .slide-bottom-lane > .slide-block-item > .slide-region-block")]
          .filter((region) => region.querySelector("[data-elef-art-root]"))
          .map((region) => {
            const controls = region.querySelector(":scope > .presentation-editor-block-controls");
            const select = controls?.querySelector("select[data-presentation-editor-align]");
            const regionRect = region.getBoundingClientRect();
            const controlsRect = controls?.getBoundingClientRect();
            return {
              lane: region.closest(".slide-middle-group") ? "middle" : "bottom",
              classes: region.className.split(/\\s+/).filter(name => name.startsWith("position-")),
              controlsDirect: controls?.parentElement === region,
              relative: getComputedStyle(region).position === "relative",
              absoluteControls: controls && getComputedStyle(controls).position === "absolute",
              topOffset: controlsRect ? Math.abs(controlsRect.top - regionRect.top) : null,
              rightOffset: controlsRect ? Math.abs(regionRect.right - controlsRect.right) : null,
              blockIndex: select?.dataset.blockIndex ?? null,
              blockId: region.querySelector(":scope > .slide-block")?.dataset.editorBlockId ?? null
            };
          });
        surface.remove();
        return result;
      })()
    JAVASCRIPT
    assert_body_grouped_art_control_geometry(rails_geometry)

    first(".presentation-surface.presentation-editor-projection [data-elef-art-root]").hover
    body_hover = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const root = document.querySelector(".presentation-surface.presentation-editor-projection [data-elef-art-root]");
        const controls = root?.closest(".slide-region-block")?.querySelector(":scope > .presentation-editor-block-controls");
        return {opacity: controls && getComputedStyle(controls).opacity, pointerEvents: controls && getComputedStyle(controls).pointerEvents};
      })()
    JAVASCRIPT
    assert_equal "1", body_hover.fetch("opacity"), body_hover.inspect
    assert_equal "auto", body_hover.fetch("pointerEvents"), body_hover.inspect

    middle_index = javascript_geometry[0].fetch("blockIndex")
    bottom_index = javascript_geometry[1].fetch("blockIndex")
    all(".presentation-surface.presentation-editor-projection [data-elef-art-root]")[1].hover
    bottom_hover = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const select = document.querySelector("select[data-presentation-editor-align][data-block-index='#{bottom_index}']");
        const controls = select?.closest(".presentation-editor-block-controls");
        return {opacity: controls && getComputedStyle(controls).opacity, pointerEvents: controls && getComputedStyle(controls).pointerEvents};
      })()
    JAVASCRIPT
    assert_equal "1", bottom_hover.fetch("opacity"), bottom_hover.inspect
    assert_equal "auto", bottom_hover.fetch("pointerEvents"), bottom_hover.inspect

    all(".presentation-surface.presentation-editor-projection [data-elef-art-root]").first.hover
    first("select[data-presentation-editor-align][data-block-index='#{middle_index}']").select("Middle Right")
    assert_field "Markdown source", with: /:::align\{middle right\}/, wait: 5
    assert_selector '[data-autosave-target="status"]', exact_text: "Saved", wait: 10

    visit edit_presentation_path(presentation)
    assert_selector "form.visual-editor-form:not([data-preview-projection-stale='true'])", wait: 10
    assert_field "Markdown source", with: /:::align\{middle right\}/
    assert_equal "middle right", first("select[data-presentation-editor-align][data-block-index='#{middle_index}']", visible: :all)["value"]
    assert_equal "bottom right", first("select[data-presentation-editor-align][data-block-index='#{bottom_index}']", visible: :all)["value"]
  end

  def grouped_art_control_geometry
    page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const surface = document.querySelector(".presentation-surface.presentation-editor-projection");
        return [...surface.querySelectorAll(".slide-region-block")].filter((region) => region.querySelector("[data-elef-art-root]")).map((region) => {
          const controls = region.querySelector(":scope > .presentation-editor-block-controls");
          const select = controls?.querySelector("select[data-presentation-editor-align]");
          const regionRect = region.getBoundingClientRect();
          const controlsRect = controls?.getBoundingClientRect();
          return {
            classes: region.className.split(/\\s+/).filter(name => name.startsWith("position-")),
            controlsDirect: controls?.parentElement === region,
            relative: getComputedStyle(region).position === "relative",
            absoluteControls: controls && getComputedStyle(controls).position === "absolute",
            topOffset: controlsRect ? Math.abs(controlsRect.top - regionRect.top) : null,
            rightOffset: controlsRect ? Math.abs(regionRect.right - controlsRect.right) : null,
            blockIndex: select?.dataset.blockIndex ?? null,
            blockId: region.querySelector(":scope > .slide-block")?.dataset.editorBlockId ?? null
          };
        });
      })()
    JAVASCRIPT
  end

  def assert_grouped_art_control_geometry(geometry)
    assert_equal 6, geometry.length
    geometry.each_with_index do |entry, index|
      expected_horizontal = %w[left center right][index / 2]
      expected_vertical = index.even? ? "middle" : "bottom"
      assert_includes entry.fetch("classes"), "position-#{expected_horizontal}"
      assert_includes entry.fetch("classes"), "position-#{expected_vertical}"
      assert entry.fetch("controlsDirect"), "Art controls must be direct children of their Art region: #{entry.inspect}"
      assert entry.fetch("relative"), "Art region must establish the controls' positioning context: #{entry.inspect}"
      assert entry.fetch("absoluteControls"), "Art controls must remain absolutely positioned: #{entry.inspect}"
      assert_in_delta 0, entry.fetch("topOffset"), 1, entry.inspect
      assert_in_delta 0, entry.fetch("rightOffset"), 1, entry.inspect
      block_id_index = entry.fetch("blockId").match(/block-(\d+)\z/)[1].to_i - 1
      assert_equal block_id_index.to_s, entry.fetch("blockIndex")
    end
  end

  def body_grouped_art_control_geometry(surface_selector)
    page.evaluate_script(<<~JAVASCRIPT, surface_selector)
      (() => {
        const surface = document.querySelector(arguments[0]);
        return [...surface.querySelectorAll(".slide-middle-group > .slide-block-item > .slide-region-block, .slide-bottom-lane > .slide-block-item > .slide-region-block")]
          .filter((region) => region.querySelector("[data-elef-art-root]"))
          .map((region) => {
            const controls = region.querySelector(":scope > .presentation-editor-block-controls");
            const select = controls?.querySelector("select[data-presentation-editor-align]");
            const regionRect = region.getBoundingClientRect();
            const controlsRect = controls?.getBoundingClientRect();
            return {
              lane: region.closest(".slide-middle-group") ? "middle" : "bottom",
              classes: region.className.split(/\\s+/).filter(name => name.startsWith("position-")),
              controlsDirect: controls?.parentElement === region,
              relative: getComputedStyle(region).position === "relative",
              absoluteControls: controls && getComputedStyle(controls).position === "absolute",
              topOffset: controlsRect ? Math.abs(controlsRect.top - regionRect.top) : null,
              rightOffset: controlsRect ? Math.abs(regionRect.right - controlsRect.right) : null,
              blockIndex: select?.dataset.blockIndex ?? null,
              blockId: region.querySelector(":scope > .slide-block")?.dataset.editorBlockId ?? null
            };
          });
      })()
    JAVASCRIPT
  end

  def assert_body_grouped_art_control_geometry(geometry)
    assert_equal 2, geometry.length
    geometry.each_with_index do |entry, index|
      expected_lane = index.zero? ? "middle" : "bottom"
      expected_horizontal = index.zero? ? "left" : "right"
      expected_vertical = index.zero? ? "middle" : "bottom"
      assert_equal expected_lane, entry.fetch("lane"), entry.inspect
      assert_includes entry.fetch("classes"), "position-#{expected_horizontal}"
      assert_includes entry.fetch("classes"), "position-#{expected_vertical}"
      assert entry.fetch("controlsDirect"), "Art controls must be direct children of their Art region: #{entry.inspect}"
      assert entry.fetch("relative"), "Art region must establish the controls' positioning context: #{entry.inspect}"
      assert entry.fetch("absoluteControls"), "Art controls must remain absolutely positioned: #{entry.inspect}"
      assert_in_delta 0, entry.fetch("topOffset"), 1, entry.inspect
      assert_in_delta 0, entry.fetch("rightOffset"), 1, entry.inspect
      block_id_index = entry.fetch("blockId").match(/block-(\d+)\z/)[1].to_i - 1
      assert_equal block_id_index.to_s, entry.fetch("blockIndex")
    end
  end

  test "a hidden fixed Art host stays pending until it becomes measurable" do
    presentation = Presentation.create!(title: "Hidden Art host", source: ":::art\n- Alpha\n- Beta")
    visit edit_presentation_path(presentation)
    wait_for_art_settled

    page.execute_script(<<~JAVASCRIPT)
      const root = document.querySelector(".presentation-surface[data-controller~='art-layout'] [data-elef-art-root]");
      root.closest('[data-art-host="fixed"]').style.display = "none";
    JAVASCRIPT
    assert_selector ".presentation-surface[data-controller~='art-layout'] [data-elef-art-root][data-art-status='pending'][data-art-settled='false']", visible: false, wait: 5

    page.execute_script(<<~JAVASCRIPT)
      const root = document.querySelector(".presentation-surface[data-controller~='art-layout'] [data-elef-art-root]");
      root.closest('[data-art-host="fixed"]').style.removeProperty("display");
    JAVASCRIPT
    assert_selector ".presentation-surface[data-controller~='art-layout'] [data-elef-art-root][data-art-status='ready'][data-art-settled='true']", wait: 5
  end

  test "compact horizontal Sequence with an unbreakable lead falls back to wrapped vertical Sequence" do
    long_word = "ElefArtUnbreakable" + ("x" * 600)
    presentation = Presentation.create!(title: "Art long token", source: ":::art\n1. #{long_word}\n2. Continue")
    visit edit_presentation_path(presentation)
    wait_for_art_settled

    art = find(".presentation-surface[data-controller~='art-layout'] [data-elef-art-root]")
    assert_equal "sequence", art["data-art-mode"]
    assert_equal "compact", art["data-art-density"]
    assert_equal "sequence-vertical", art["data-art-layout"]
    assert_equal "ready", art["data-art-status"]
    assert_equal long_word, art.all(".elef-art-list > li").first.text

    page.execute_script(<<~JAVASCRIPT)
      const surface = document.querySelector(".presentation-surface[data-controller~='art-layout']");
      const controller = window.Stimulus.getControllerForElementAndIdentifier(surface, "art-layout");
      const root = surface.querySelector("[data-elef-art-root]");
      const stats = window.__artFallbackStats = {decisions: 0, measurements: 0, fallbackMeasurements: 0, layoutWrites: 0};
      const decision = controller.runDecisionPass.bind(controller);
      const measurement = controller.runMeasurementPass.bind(controller);
      const fallback = controller.runFallbackMeasurement.bind(controller);
      controller.runDecisionPass = (...args) => { stats.decisions += 1; return decision(...args); };
      controller.runMeasurementPass = (roots) => { stats.measurements += 1; return measurement(roots); };
      controller.runFallbackMeasurement = (roots) => { stats.fallbackMeasurements += 1; return fallback(roots); };
      root.dataset.artLayout = "sequence-vertical";
      root.dataset.artStatus = "pending";
      root.dataset.artSettled = "false";
      new MutationObserver((records) => { stats.layoutWrites += records.length; }).observe(root, {attributes: true, attributeFilter: ["data-art-layout"]});
      controller.schedule();
    JAVASCRIPT
    fallback_stats = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[0];
      setTimeout(() => done({...window.__artFallbackStats, layout: document.querySelector(".presentation-surface [data-elef-art-root]").dataset.artLayout}), 500);
    JAVASCRIPT
    assert_equal "sequence-vertical", fallback_stats.fetch("layout")
    assert_equal 1, fallback_stats.fetch("decisions"), fallback_stats.inspect
    assert_equal 1, fallback_stats.fetch("measurements"), fallback_stats.inspect
    assert_equal 1, fallback_stats.fetch("fallbackMeasurements"), fallback_stats.inspect
    assert_equal 2, fallback_stats.fetch("layoutWrites"), fallback_stats.inspect
  end

  test "document Sequence preserves order and reflows at 320, 640, and 320 CSS pixels in RTL" do
    source = ":::art\n1. Reliability and availability\n2. Simplicity and clarity\n3. Performance under load\n4. Portability across platforms\n5. Long authored content remains complete"
    document = Document.create!(title: "Art reflow", source: source)
    visit edit_document_path(document)

    measurements = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const root = document.querySelector(".document-surface [data-elef-art-root]");
        const list = root.querySelector(".elef-art-list");
        const shell = root.closest(".document-editor-block-shell");
        const expectedOrder = [...list.children].map((item) => item.textContent.trim());
        root.dir = "rtl";
        return [320, 640, 320].map((width) => {
          shell.style.inlineSize = `${width}px`;
          shell.style.maxInlineSize = `${width}px`;
          root.style.inlineSize = "100%";
          const items = [...list.children];
          return {
            width,
            mode: root.dataset.artMode,
            direction: getComputedStyle(root).direction,
          nativeList: list.tagName === "OL" && getComputedStyle(list).listStyleType === "decimal",
            connectors: items.map((item) => {
              const connector = getComputedStyle(item, "::before");
              return {content: connector.content, inlineStart: Number.parseFloat(connector.insetInlineStart), inlineCenter: item.clientWidth / 2 - 0.5, blockSize: connector.blockSize};
            }),
            order: items.map((item) => item.textContent.trim()),
            hostFits: root.scrollWidth <= root.clientWidth && list.scrollWidth <= list.clientWidth && items.every((item) => item.scrollWidth <= item.clientWidth)
          };
        }).map((measurement) => ({...measurement, expectedOrder}));
      })()
    JAVASCRIPT
    assert_equal [320, 640, 320], measurements.map { |measurement| measurement.fetch("width") }
    measurements.each do |measurement|
      assert_equal "sequence", measurement.fetch("mode")
      assert_equal "rtl", measurement.fetch("direction")
      assert measurement.fetch("nativeList"), measurement.inspect
      connectors = measurement.fetch("connectors")
      assert_equal "none", connectors.first.fetch("content"), measurement.inspect
      assert connectors.drop(1).all? { |connector| connector.fetch("content") != "none" }, measurement.inspect
      assert connectors.drop(1).all? { |connector| (connector.fetch("inlineCenter") - connector.fetch("inlineStart")).abs <= 1 }, measurement.inspect
      assert connectors.drop(1).all? { |connector| connector.fetch("blockSize") == "16px" }, measurement.inspect
      assert_equal measurement.fetch("expectedOrder"), measurement.fetch("order")
      assert measurement.fetch("hostFits"), measurement.inspect
    end
  end

  test "100 fixed Art roots share one bounded lifecycle pass without observer oscillation" do
    slides = 100.times.map do |index|
      "# Slide #{index + 1}\n\n:::art\n- Alpha #{index + 1}\n- Beta #{index + 1}"
    end
    presentation = Presentation.create!(title: "Many Art roots", source: slides.join("\n---\n"))
    visit edit_presentation_path(presentation)
    assert_selector ".presentation-surface[data-controller~='art-layout'] [data-elef-art-root][data-art-settled='true']", count: 100, wait: 20
    page.evaluate_async_script("const done = arguments[0]; document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 250))));")

    page.execute_script(<<~JAVASCRIPT)
      const surface = document.querySelector(".presentation-surface[data-controller~='art-layout']");
      const controller = window.Stimulus.getControllerForElementAndIdentifier(surface, "art-layout");
      const stats = window.__artLifecycleStats = {decisions: 0, measurementPasses: 0, measuredRoots: 0, fallbackPasses: 0, fallbackRoots: 0, layoutWrites: 0};
      const decision = controller.runDecisionPass.bind(controller);
      const measurement = controller.runMeasurementPass.bind(controller);
      const fallback = controller.runFallbackMeasurement.bind(controller);
      controller.runDecisionPass = (...args) => { stats.decisions += 1; return decision(...args); };
      controller.runMeasurementPass = (roots) => { stats.measurementPasses += 1; stats.measuredRoots += roots.length; return measurement(roots); };
      controller.runFallbackMeasurement = (roots) => { stats.fallbackPasses += 1; stats.fallbackRoots += roots.length; return fallback(roots); };
      const observer = new MutationObserver((records) => { stats.layoutWrites += records.length; });
      controller.roots.forEach((root) => observer.observe(root, {attributes: true, attributeFilter: ["data-art-layout"]}));
      controller.schedule();
    JAVASCRIPT
    stats = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[0];
      setTimeout(() => done({...window.__artLifecycleStats, rootCount: document.querySelectorAll(".presentation-surface[data-controller~='art-layout'] [data-elef-art-root]").length}), 700);
    JAVASCRIPT
    assert_equal 100, stats.fetch("rootCount")
    assert_equal 1, stats.fetch("decisions"), stats.inspect
    assert_equal 1, stats.fetch("measurementPasses"), stats.inspect
    assert_equal 100, stats.fetch("measuredRoots"), stats.inspect
    assert_equal 0, stats.fetch("fallbackPasses"), stats.inspect
    assert_equal 0, stats.fetch("layoutWrites"), stats.inspect

    page.execute_script(<<~JAVASCRIPT)
      const surface = document.querySelector(".presentation-surface[data-controller~='art-layout']");
      const controller = window.Stimulus.getControllerForElementAndIdentifier(surface, "art-layout");
      const stats = window.__artLifecycleStats;
      Object.keys(stats).forEach((key) => { if (key !== "rootCount") stats[key] = 0; });
      const first = surface.querySelector("[data-elef-art-root]");
      first.querySelector(".elef-art-list > li").firstChild.data += " changed";
    JAVASCRIPT
    incremental_stats = page.evaluate_async_script(<<~JAVASCRIPT)
      const done = arguments[0];
      setTimeout(() => done({...window.__artLifecycleStats}), 700);
    JAVASCRIPT
    assert_equal 1, incremental_stats.fetch("decisions"), incremental_stats.inspect
    assert_equal 1, incremental_stats.fetch("measurementPasses"), incremental_stats.inspect
    assert_equal 1, incremental_stats.fetch("measuredRoots"), incremental_stats.inspect
  end

  test "print views preserve document pagination and settled presentation Sequence states" do
    continuation = "supports cross-platform delivery and helps teams measure success " * 4
    sequence_items = (3..22).map { |number| "#{number}. Step #{number} #{continuation}" }.join("\n")
    document = Document.create!(title: "Printable Art Sequence", source: ":::art\n#{sequence_items}")
    visit print_document_path(document)
    assert_selector ".document-surface[data-document-pages-settled='true']", wait: 15
    document_fragments = page.evaluate_script(<<~JAVASCRIPT)
      [...document.querySelectorAll(".document-page-frame .elef-art-list")].map((list) => ({start: list.hasAttribute("start") ? Number(list.getAttribute("start")) : 1, items: list.children.length, text: list.textContent}));
    JAVASCRIPT
    assert_operator document_fragments.length, :>, 1, document_fragments.inspect
    assert_equal 20, document_fragments.sum { |fragment| fragment.fetch("items") }
    assert_equal 3, document_fragments.first.fetch("start")
    document_fragments.each_cons(2) do |current, following|
      assert_equal current.fetch("start") + current.fetch("items"), following.fetch("start")
    end
    assert_includes document_fragments.map { |fragment| fragment.fetch("text") }.join(" "), "Step 22"

    compact = Presentation.create!(title: "Printable horizontal Art", source: ":::art\n#{(1..4).map { |number| "#{number}. Step #{number}" }.join("\n")}")
    visit print_presentation_path(compact)
    assert_selector ".presentation-print [data-elef-art-root][data-art-settled='true']", wait: 15
    assert_equal "sequence-horizontal", find(".presentation-print [data-elef-art-root]")["data-art-layout"]
    assert_equal "ready", find(".presentation-print [data-elef-art-root]")["data-art-status"]
    page.driver.browser.execute_cdp("Emulation.setEmulatedMedia", media: "print")
    page.evaluate_async_script("const done = arguments[0]; requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 300))); ")
    assert_equal "sequence-horizontal", find(".presentation-print [data-elef-art-root]")["data-art-layout"]
    print_state = page.evaluate_script("(() => { const root = document.querySelector('.presentation-print [data-elef-art-root]'); const host = root.closest('[data-art-host=\"fixed\"]'); return {status: root.dataset.artStatus, settled: root.dataset.artSettled, layout: root.dataset.artLayout, host: host && [host.clientWidth, host.clientHeight, host.scrollWidth, host.scrollHeight], root: [root.clientWidth, root.clientHeight, root.scrollWidth, root.scrollHeight], print: matchMedia('print').matches} })()")
    assert_equal "ready", print_state.fetch("status"), print_state.inspect
    page.driver.browser.execute_cdp("Emulation.setEmulatedMedia", media: "screen")

    overfull = Presentation.create!(title: "Printable Art no-fit", source: "# Hiring pipeline\n\n:::art\n#{(1..8).map { |number| "#{number}. Step #{number}" }.join("\n")}")
    visit print_presentation_path(overfull)
    assert_selector ".presentation-print [data-elef-art-root][data-art-settled='true']", wait: 15
    no_fit = find(".presentation-print [data-elef-art-root]")
    assert_equal "fallback-no-fit", no_fit["data-art-status"]
    assert_equal "ART_NO_FIT", no_fit["data-art-diagnostic"]
    assert_equal "true", no_fit.find(:xpath, "ancestor::*[@data-art-host='fixed']")["data-art-overfull"]
    assert_equal 8, no_fit.all(".elef-art-list > li").length
    page.driver.browser.execute_cdp("Emulation.setEmulatedMedia", media: "print")
    page.evaluate_async_script("const done = arguments[0]; requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(done, 300))); ")
    no_fit_print = page.evaluate_script("(() => { const root = document.querySelector('.presentation-print [data-elef-art-root]'); const host = root.closest('[data-art-host=\"fixed\"]'); return {status: root.dataset.artStatus, settled: root.dataset.artSettled, layout: root.dataset.artLayout, host: host && [host.clientWidth, host.clientHeight, host.scrollWidth, host.scrollHeight], root: [root.clientWidth, root.clientHeight, root.scrollWidth, root.scrollHeight], print: matchMedia('print').matches} })()")
    assert_equal "fallback-no-fit", no_fit_print.fetch("status"), no_fit_print.inspect
    assert_equal 8, find(".presentation-print [data-elef-art-root]").all(".elef-art-list > li").length
    page.driver.browser.execute_cdp("Emulation.setEmulatedMedia", media: "screen")
  end
end
