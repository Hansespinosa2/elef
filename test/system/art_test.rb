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
      source: ":::art\n1. Discover\n2. Design\n3. Build\n4. Launch"
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
    assert_operator data.fetch("width"), :>, 0
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
          return list ? { count: list.children.length, start: list.hasAttribute("start") ? Number(list.getAttribute("start")) : 1, clientHeight: content.clientHeight, scrollHeight: content.scrollHeight, blocks: [...content.children].map((block) => ({height: block.offsetHeight, styleHeight: block.style.height, text: block.textContent.slice(0, 40)})) } : null;
        }).filter(Boolean)
      JAVASCRIPT
      assert_equal [2, count - 2], fragments.map { |fragment| fragment.fetch("count") }, { initial: initial, fragments: fragments }.inspect
      assert_equal [start, expected_start], fragments.map { |fragment| fragment.fetch("start") }

      page.execute_script("window.Stimulus.getControllerForElementAndIdentifier(document.querySelector('.document-editor-projection'), 'document-pages').paginate()")
      assert_selector ".document-surface[data-document-pages-settled='true']", wait: 10
      repeated = page.evaluate_script(<<~JAVASCRIPT)
        [...document.querySelectorAll(".document-page-frame .elef-art-list")].map((list) => [list.children.length, list.hasAttribute("start") ? Number(list.getAttribute("start")) : 1])
      JAVASCRIPT
      assert_equal fragments.map { |fragment| [fragment.fetch("count"), fragment.fetch("start")] }, repeated
    end
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
    state = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const form = document.querySelector("form.visual-editor-form");
        const root = document.querySelector("[data-art-item-too-tall='true']");
        const actualWarnings = [...document.querySelectorAll(".preview-warnings li")].map((item) => item.textContent);
        const actualWarningCount = form?.previewController?.artWarnings?.size ?? null;
        root?.dispatchEvent(new CustomEvent("elef:art-diagnostic", {
          bubbles: true,
          detail: { code: "ART_ITEM_TOO_TALL", message: "manual Art warning event" }
        }));
        return {
          warnings: actualWarnings,
          actualWarningCount,
          afterManualWarningCount: form?.previewController?.artWarnings?.size ?? null,
          previewController: Boolean(form?.previewController),
          artDiagnostic: root?.dataset.artDiagnostic || null,
          warningsTarget: Boolean(document.querySelector(".preview-warnings"))
        };
      })()
    JAVASCRIPT
    assert_includes state.fetch("warnings").join(" "), "taller than a document page", state.inspect
  end

  test "rich fixed Sequence stays vertical and eight compact items show no-fit" do
    rich = Presentation.create!(
      title: "Art rich Sequence",
      source: ":::art\n1. Discovery\n   - Interview users\n   - Map the current process\n2. Design\n   - Prioritize constraints\n   - Produce a prototype\n3. Delivery\n   - Build the system\n   - Validate with teams\n4. Adoption\n   - Train users\n   - Measure outcomes"
    )
    visit edit_presentation_path(rich)
    wait_for_art_settled
    assert_selector "[data-elef-art-root][data-art-mode='sequence'][data-art-density='rich']", wait: 10
    rich_state = page.evaluate_script("(() => { const root = document.querySelector('.presentation-surface[data-controller~=\"art-layout\"] [data-elef-art-root]'); const host = root.closest('[data-art-host=\"fixed\"]'); const items = [...root.querySelector('.elef-art-list').children]; return {layout: root.dataset.artLayout, status: root.dataset.artStatus, diagnostic: root.dataset.artDiagnostic || null, root: [root.scrollWidth, root.clientWidth, root.scrollHeight, root.clientHeight], host: [host.scrollWidth, host.clientWidth, host.scrollHeight, host.clientHeight], items: items.map((item) => [item.scrollWidth, item.clientWidth, item.scrollHeight, item.clientHeight])} })()")
    assert_equal("sequence-vertical", rich_state.fetch("layout"), rich_state.inspect)
    assert_equal("ready", rich_state.fetch("status"), rich_state.inspect)
    assert_nil rich_state.fetch("diagnostic"), rich_state.inspect

    many = Presentation.create!(title: "Art no-fit", source: ":::art\n#{(1..8).map { |index| "#{index}. Step #{index}" }.join("\n")}")
    visit edit_presentation_path(many)
    wait_for_art_settled
    art = find(".presentation-surface[data-controller~='art-layout'] [data-elef-art-root]")
    assert_equal "fallback-no-fit", art["data-art-status"]
    assert_equal "ART_NO_FIT", art["data-art-diagnostic"]
    assert_equal 8, art.all(".elef-art-list > li").length
    assert_selector ".preview-warnings li", text: /does not fit the fixed slide/
  end
end
