require "application_system_test_case"
require "digest"
require "json"

# Opt-in acceptance benchmark. Each sample includes the real Rails response,
# editor mount, font readiness and a painted frame. The input probe sends one
# uninterrupted trusted keyboard burst and observes key-to-frame durations and
# browser long tasks. Frozen fixture bytes stay owned by manifest.json.
class ContinuousAuthoringPerformanceTest < ApplicationSystemTestCase
  ROOT = Rails.root.join("test/fixtures/performance")
  SAMPLES = 20
  BURST = " A sustained authoring session with mathematics and prose."

  def p95(values)
    values.sort.fetch((values.length * 0.95).ceil - 1)
  end

  def fixture_document(name, source)
    document = Document.create!(title: "Continuous performance #{name}", source: source)
    Dir.glob(ROOT.join("assets/*")).sort.each do |path|
      next unless source.include?(File.basename(path))
      File.open(path, "rb") do |file|
        document.assets.attach(io: file, filename: File.basename(path), content_type: Rack::Mime.mime_type(File.extname(path)))
      end
    end
    document
  end

  test "continuous opening and sustained input meet the frozen fixture budgets" do
    report = {
      checkout: IO.popen(["git", "rev-parse", "HEAD"], &:read).strip,
      tracked_changes: !system("git", "diff", "--quiet"),
      ruby: RUBY_VERSION, platform: RUBY_PLATFORM, browser: page.driver.browser.capabilities.browser_version,
      viewport: [1400, 1000], runner: ENV["RUNNER_NAME"] || "local",
      budgets_ms: { open_p95: 3000, input_p95: 50, stall: 100 }, samples: SAMPLES, fixtures: {}
    }
    manifest = JSON.parse(File.read(ROOT.join("manifest.json")))
    page.driver.browser.manage.timeouts.script = 30
    begin
      { "mixed" => "elef-visual-100-mixed.md", "math_heavy" => "elef-visual-100-math.md" }.each do |name, filename|
        source = File.read(ROOT.join(filename))
        assert_equal manifest.dig("fixtures", name, "sha256"), Digest::SHA256.hexdigest(source), "#{name}: frozen fixture bytes"
        document = fixture_document(name, source)
        opens = SAMPLES.times.map do
          start = Process.clock_gettime(Process::CLOCK_MONOTONIC)
          visit edit_document_path(document, editor_surface: "continuous")
          assert_selector ".continuous-document", wait: 20
          readiness = page.evaluate_async_script(<<~JAVASCRIPT)
            const done = arguments[arguments.length - 1];
            const deadline = performance.now() + 15000;
            function check() {
              const editor = document.querySelector('.continuous-document');
              const math = [...editor.querySelectorAll('.cm-live-widget-math, .cm-live-widget-math-display')];
              const images = [...editor.querySelectorAll('img.cm-live-image')];
              if (document.fonts.status === 'loaded' && math.every(node => node.querySelector('math')) &&
                  images.every(node => node.complete && node.naturalWidth > 0)) {
                return requestAnimationFrame(() => requestAnimationFrame(() => done({ ready: true, math: math.length, images: images.length })));
              }
              if (performance.now() >= deadline) return done({ ready: false, math: math.length, images: images.length });
              setTimeout(check, 30);
            }
            check();
          JAVASCRIPT
          assert readiness["ready"], "#{name}: visible math and images must render before open is measured: #{readiness.inspect}"
          (Process.clock_gettime(Process::CLOCK_MONOTONIC) - start) * 1000
        end
        page.driver.browser.action.key_down(:control).send_keys(:end).key_up(:control).perform
        supported = page.evaluate_script(<<~JAVASCRIPT)
          (() => {
            if (!PerformanceObserver.supportedEntryTypes.includes('longtask')) return false;
            const editor = document.querySelector('.continuous-document .cm-content');
            window.continuousPerf = { start: performance.now(), keys: [], stalls: [] };
            new PerformanceObserver(list => {
              window.continuousPerf.stalls.push(...list.getEntries()
                .filter(entry => entry.startTime >= window.continuousPerf.start)
                .map(entry => entry.duration));
            }).observe({ type: 'longtask' });
            editor.addEventListener('keydown', event => {
              if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
              const start = performance.now();
              requestAnimationFrame(() => window.continuousPerf.keys.push(performance.now() - start));
            });
            return true;
          })()
        JAVASCRIPT
        assert supported, "#{name}: browser must expose long-task measurements"
        page.driver.browser.action.send_keys(BURST).perform
        measurements = page.evaluate_async_script(<<~JAVASCRIPT)
          const done = arguments[arguments.length - 1];
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => done(window.continuousPerf), 100)));
        JAVASCRIPT
        assert_equal source + BURST, page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
        assert_equal BURST.length, measurements.fetch("keys").length, "#{name}: every typed character is measured"
        report[:fixtures][name] = {
          open_ms: opens.map { |value| value.round(1) }, open_p95_ms: p95(opens).round(1),
          input_ms: measurements.fetch("keys").map { |value| value.round(1) },
          input_p95_ms: p95(measurements.fetch("keys")).round(1),
          long_tasks_ms: measurements.fetch("stalls").map { |value| value.round(1) }
        }
      end
    ensure
      path = ENV.fetch("ELEF_CONTINUOUS_PERF_REPORT", "/tmp/elef-continuous-performance.json")
      File.write(path, JSON.pretty_generate(report))
      puts "CONTINUOUS_PERF_REPORT #{path}"
    end
    report[:fixtures].each do |name, result|
      assert_operator result[:open_p95_ms], :<=, 3000, "#{name}: open p95"
      assert_operator result[:input_p95_ms], :<=, 50, "#{name}: sustained input p95"
      assert_empty result[:long_tasks_ms].select { |duration| duration > 100 }, "#{name}: authoring stalls over 100ms"
    end
  end if ENV["ELEF_PERF_MODE"] == "continuous"
end
