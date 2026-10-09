require "application_system_test_case"

class PresentationAlignmentGrammarTest < ApplicationSystemTestCase
  CORPUS = JSON.parse(Rails.root.join("docs/align-directives-grammar/fixtures.json").read).fetch("fixtures").freeze

  test "all decided alignment fixtures render with matching DOM structure and geometry" do
    source = CORPUS.map { |fixture| fixture.fetch("source") }.join("\n\n---\n\n")
    presentation = Presentation.create!(title: "Alignment grammar fixtures", source: source)

    visit presentation_path(presentation)
    assert_selector ".slides > .slide-frame > .slide", count: CORPUS.length, wait: 10

    rendered = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const rect = (element) => {
          const bounds = element.getBoundingClientRect();
          return { top: bounds.top, bottom: bounds.bottom, left: bounds.left, right: bounds.right, height: bounds.height };
        };
        const label = (block) => block.textContent.trim().replace(/\\s+/g, " ");
        const slides = [...document.querySelectorAll(".slides > .slide-frame > .slide")];
        slides.forEach((slide) => slide.style.setProperty("--slide-scale", "1"));
        return slides.map((slide) => {
          const content = slide.querySelector(".slide-content");
          const groups = [...slide.querySelectorAll(".slide-middle-group")];
          const lanes = [...slide.querySelectorAll(".slide-bottom-lane")];
          const blockElements = [...slide.querySelectorAll(".slide-block")];
          return {
            layout: [...slide.classList].find((name) => name.startsWith("slide-") && name !== "slide-frame"),
            regions: slide.querySelectorAll(".slide-region").length,
            regionPlacements: [...slide.querySelectorAll(".slide-region")].map(region => ({
              middleGroups: [...region.querySelectorAll(".slide-middle-group")].map(group => [...group.querySelectorAll(".slide-block")].map(label)),
              bottomLanes: [...region.querySelectorAll(".slide-bottom-lane")].map(lane => [...lane.querySelectorAll(".slide-block")].map(label))
            })),
            blocks: blockElements.map((block) => ({ label: label(block), classes: [...block.classList], ...rect(block) })),
            groups: groups.map((group) => {
              const parent = group.parentElement;
              const previous = group.previousElementSibling;
              const next = group.nextElementSibling;
              return {
                labels: [...group.querySelectorAll(".slide-block")].map(label),
                flushBottom: group.classList.contains("flush-bottom"),
                topMargin: rect(group).top - (previous ? rect(previous).bottom : rect(parent).top),
                bottomMargin: (next ? rect(next).top : rect(parent).bottom) - rect(group).bottom,
                gaps: [...group.querySelectorAll(".slide-block")].slice(1).map((block, index) => rect(block).top - rect(group.querySelectorAll(".slide-block")[index]).bottom)
              };
            }),
            lanes: lanes.map((lane) => ({
              labels: [...lane.querySelectorAll(".slide-block")].map(label),
              bottomGap: rect(lane.parentElement).bottom - rect(lane).bottom,
              gaps: [...lane.querySelectorAll(".slide-block")].slice(1).map((block, index) => rect(block).top - rect(lane.querySelectorAll(".slide-block")[index]).bottom)
            })),
            content: rect(content),
            slide: rect(slide)
          };
        });
      })()
    JAVASCRIPT

    CORPUS.each_with_index do |fixture, index|
      expected = fixture.fetch("expected")
      actual = rendered[index]
      id = fixture.fetch("id")

      assert_equal "slide-#{expected.fetch('layout')}", actual.fetch("layout"), "#{id} layout"
      assert_equal expected.fetch("middleGroups"), actual.fetch("groups").map { |group| group.fetch("labels") }, "#{id} groups"
      assert_equal expected.fetch("bottomLanes"), actual.fetch("lanes").map { |lane| lane.fetch("labels") }, "#{id} lanes"
      assert_equal expected.fetch("regionPlacements"), actual.fetch("regionPlacements"), "#{id} per-region placement" if expected.key?("regionPlacements")
      assert_equal expected.fetch("flushBottom", false), actual.fetch("groups").any? { |group| group.fetch("flushBottom") }, "#{id} docking"
      assert_equal 2, actual.fetch("regions"), "#{id} column regions" if expected.fetch("layout").include?("column")

      expected.fetch("blockClasses").each do |text, classes|
        block = actual.fetch("blocks").find { |candidate| candidate.fetch("label").include?(text) }
        assert block, "#{id} block #{text} is rendered"
        classes.each { |class_name| assert_includes block.fetch("classes"), class_name, "#{id} #{text} class" }
      end

      actual.fetch("groups").each do |group|
        if fixture.fetch("geometry").any? { |assertion| assertion.include?("group marginTop") }
          assert_in_delta group.fetch("topMargin"), group.fetch("bottomMargin"), 1, "#{id} group margins"
        end
      end
      if fixture.fetch("geometry").any? { |assertion| assertion.include?("gap between") || assertion.include?("gaps between") }
        (actual.fetch("groups").flat_map { |group| group.fetch("gaps") } + actual.fetch("lanes").flat_map { |lane| lane.fetch("gaps") }).each do |gap|
          assert_operator gap, :<, 8, "#{id} snug block gap"
        end
      end
      if fixture.fetch("geometry").any? { |assertion| assertion.include?("lane bottom edge") }
        actual.fetch("lanes").each { |lane| assert_in_delta 0, lane.fetch("bottomGap"), 1, "#{id} lane is pinned" }
      end
      if fixture.fetch("geometry").any? { |assertion| assertion.include?("top edge == content top edge") }
        text = fixture.fetch("id") == "F-03" ? "Kicker" : "Deck title"
        block = actual.fetch("blocks").find { |candidate| candidate.fetch("label").include?(text) }
        assert_in_delta actual.fetch("content").fetch("top"), block.fetch("top"), 1, "#{id} top-pinned block"
      end
      if fixture.fetch("id") == "F-04"
        block = actual.fetch("blocks").find { |candidate| candidate.fetch("label").include?("Body text") }
        assert_in_delta actual.fetch("content").fetch("left"), block.fetch("left"), 1, "F-04 default horizontal alignment"
      end
      if fixture.fetch("id") == "F-09"
        blocks = actual.fetch("lanes").first.fetch("labels")
        bounds = actual.fetch("blocks").select { |block| blocks.include?(block.fetch("label")) }
        assert_operator bounds.last.fetch("top"), :>, bounds.first.fetch("bottom"), "F-09 blocks occupy separate rows"
      end
      if fixture.fetch("id") == "F-12"
        block = actual.fetch("blocks").find { |candidate| candidate.fetch("label").include?("Deck title") }
        assert_in_delta actual.fetch("content").fetch("top"), block.fetch("top"), 1, "F-12 column title is top-pinned"
      end
      if fixture.fetch("id") == "F-15"
        assert_equal 1, actual.fetch("blocks").length, "F-15 keeps the title and drops the dangling directive"
      end
      if fixture.fetch("id") == "F-16"
        title = actual.fetch("blocks").find { |candidate| candidate.fetch("label").include?("Untitled Document") }
        assert_in_delta actual.fetch("slide").fetch("top") + actual.fetch("slide").fetch("height") / 2,
          title.fetch("top") + title.fetch("height") / 2, 50, "F-16 title center"
        gap = actual.fetch("blocks").find { |block| block.fetch("label").include?("Start writing Markdown here.") }.fetch("top") - title.fetch("bottom")
        assert_operator gap, :<, 8, "F-16 title and subtitle stay together"
      end
    end
  end

  test "print output docks the footer lane below a snug middle stack" do
    source = <<~MARKDOWN
      :::align{middle center}
      # Title

      :::align{center}
      Subtitle

      :::align{bottom center}
      Footer
    MARKDOWN
    presentation = Presentation.create!(title: "Printed alignment", source: source)

    visit print_presentation_path(presentation)
    assert_selector ".presentation-print .slide-middle-group.flush-bottom .slide-block", count: 2
    assert_selector ".presentation-print .slide-bottom-lane .slide-block", count: 1

    browser = page.driver.browser
    browser.execute_cdp("Emulation.setEmulatedMedia", media: "print")
    geometry = page.evaluate_script(<<~JAVASCRIPT)
      (() => {
        const slide = document.querySelector(".presentation-print .slide");
        const content = slide.querySelector(".slide-content");
        const group = content.querySelector(".slide-middle-group");
        const lane = content.querySelector(".slide-bottom-lane");
        const blocks = [...group.querySelectorAll(".slide-block")];
        const rect = (element) => element.getBoundingClientRect();
        return {
          print: matchMedia("print").matches,
          stackGap: rect(blocks[1]).top - rect(blocks[0]).bottom,
          dockGap: rect(lane).top - rect(group).bottom,
          laneBottomGap: rect(content).bottom - rect(lane).bottom,
          slideHeight: rect(slide).height
        };
      })()
    JAVASCRIPT

    assert geometry.fetch("print"), geometry.inspect
    assert_operator geometry.fetch("stackGap"), :<, 8, geometry.inspect
    assert_operator geometry.fetch("dockGap"), :<, 8, geometry.inspect
    assert_in_delta 0, geometry.fetch("laneBottomGap"), 1, geometry.inspect
    assert_in_delta 720, geometry.fetch("slideHeight"), 2, geometry.inspect
  ensure
    page&.driver&.browser&.execute_cdp("Emulation.setEmulatedMedia", media: "screen")
  end
end
