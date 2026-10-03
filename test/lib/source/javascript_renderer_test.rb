require "test_helper"
require "open3"
require "timeout"

class SourceJavascriptRendererTest < ActiveSupport::TestCase
  test "library cards escape metadata and preserve trusted view slots" do
    title = '<img src=x onerror="run()">'
    html = Source::JavascriptRenderer.library_card({
      id: "document-42", title: title, kind: "document", metadata: "Continuous Markdown",
      editUrl: "/documents/42/edit", previewHtml: "<p>Safe preview</p>", controlsHtml: "<button>Action</button>"
    })
    fragment = Nokogiri::HTML5.fragment(html)
    assert_empty fragment.css("img, script, [onclick], [onerror]")
    assert_equal title, fragment.at_css(".library-card-title").text
    assert_equal "Safe preview", fragment.at_css(".library-card-preview p").text
    assert_equal "Action", fragment.at_css(".library-card-controls button").text
  end
  INPUTS = JSON.parse(Rails.root.join("desktop/frontend/fixtures/renderer-inputs.json").read).freeze
  OUTPUTS = JSON.parse(Rails.root.join("desktop/frontend/fixtures/renderer-outputs.json").read).freeze

  INPUTS.each_with_index do |fixture, index|
    test "MiniRacer exact fixture #{fixture.fetch('name')}" do
      input = fixture.fetch("input")
      expected = OUTPUTS.fetch(index)
      assert_equal fixture.fetch("name"), expected.fetch("name")
      media_map = input.fetch("mediaMap", {})
      resolver = lambda do |identifier|
        media = media_map[identifier] || media_map["elef-asset:#{identifier}"]
        [media.fetch("src"), media.fetch("contentType")] if media
      end
      assert_equal expected.fetch("blockHtml"), Source::JavascriptRenderer.render(
        input.fetch("source"),
        media_resolver: resolver,
        allow_remote_media: input["allowRemoteMedia"] == true
      )
      actual = Source::JavascriptRenderer.editor_preview(
        input.fetch("source"), kind: input.fetch("kind"), title: input.fetch("title"),
        deck_id: input.fetch("deckId", ""),
        media_resolver: resolver,
        document_nodes: input.fetch("documentNodes", []),
        style: input.fetch("style", {}), margin_settings: input.fetch("marginSettings", {}),
        allow_remote_media: input["allowRemoteMedia"] == true
      )
      assert_equal expected.fetch("preview"), actual.deep_stringify_keys
      assert_equal expected.dig("preview", "editor_map"), Source::JavascriptRenderer.editor_map(
        input.fetch("source"), mode: input.fetch("kind"), source_name: input.fetch("title")
      ).deep_stringify_keys
    end
  end

  test "thread contexts isolate concurrent render inputs and are reused only in their owning thread" do
    contexts = 4.times.map do |number|
      Thread.new do
        first_context = Source::JavascriptRenderer.context
        20.times do |iteration|
          source = "# Thread #{number}, render #{iteration}\n\n$x^2$"
          html = Source::JavascriptRenderer.render(source)
          raise "cross-thread renderer output" unless html.include?("<h1>Thread #{number}, render #{iteration}</h1>")
          raise "context was not reused" unless first_context.equal?(Source::JavascriptRenderer.context)
        end
        first_context
      ensure
        first_context&.dispose
        Thread.current.thread_variable_set(Source::JavascriptRenderer::CONTEXT_KEY, nil)
        Thread.current.thread_variable_set(Source::JavascriptRenderer::CONTEXT_PID_KEY, nil)
      end
    end.map(&:value)
    assert_equal 4, contexts.map(&:object_id).uniq.length
  end

  test "Puma-style preload disposal and worker fork create fresh contexts and render concurrently" do
    output = nil
    status = nil
    Open3.popen2e(RbConfig.ruby, Rails.root.join("test/support/renderer_fork_probe.rb").to_s, pgroup: true) do |stdin, stdout, child|
      stdin.close
      begin
        Timeout.timeout(45) { output = stdout.read; status = child.value }
      rescue Timeout::Error
        Process.kill("KILL", -child.pid)
        flunk "Renderer worker fork probe timed out"
      end
    end
    assert status.success?, output
    assert_includes output, "renderer worker fork probe passed"
  end

  test "all renderer entry points bound the source size before evaluating JavaScript" do
    source = "x" * (Source::JavascriptRenderer::MAX_RENDER_BYTES + 1)
    assert_raises(ArgumentError) { Source::JavascriptRenderer.render(source) }
    assert_raises(ArgumentError) { Source::JavascriptRenderer.editor_map(source, source_name: "Large", mode: :document) }
    assert_raises(ArgumentError) { Source::JavascriptRenderer.editor_preview(source, kind: :document, title: "Large") }
  end
end
