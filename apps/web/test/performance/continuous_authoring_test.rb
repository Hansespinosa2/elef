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
  EQUATION_BURST = ' + \\alpha_{i} + 1'
  NEW_EQUATION_BURST = ' $\\sqrt{a_{i} + b^{2}}$'
  TABLE_BURST = " revised quickly"

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
    cpu_rate = Float(ENV.fetch("ELEF_CONTINUOUS_PERF_CPU_RATE", "1"))
    raise "CPU throttling must be at least 1" if cpu_rate < 1
    page.driver.browser.execute_cdp("Emulation.setCPUThrottlingRate", rate: cpu_rate)
    report = {
      checkout: IO.popen(["git", "rev-parse", "HEAD"], &:read).strip,
      tracked_changes: !system("git", "diff", "--quiet"),
      ruby: RUBY_VERSION, platform: RUBY_PLATFORM, browser: page.driver.browser.capabilities.browser_version,
      viewport: [1400, 1000], runner: ENV["RUNNER_NAME"] || "local", cpu_throttle: cpu_rate,
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
        if name == "mixed"
          # Exercise a real rendered cell in the long mixed fixture. As with
          # the equation probe, selection is setup; the burst itself is not
          # paced or repaired by the harness.
          page.evaluate_script(<<~JAVASCRIPT)
            (() => {
              const editor = document.querySelector('.source-field').editorController;
              const marker = '| queue worker';
              const start = editor.view.state.doc.toString().lastIndexOf(marker);
              if (start < 0) throw new Error('The frozen table cell was not found');
              editor.view.dispatch({ selection: { anchor: start + marker.length }, scrollIntoView: true });
              editor.view.focus();
            })()
          JAVASCRIPT
          page.evaluate_async_script("const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(done));")
          page.evaluate_script(<<~JAVASCRIPT)
            (() => {
              const editor = document.querySelector('.continuous-document .cm-content');
              window.tablePerf = { start: performance.now(), keys: [], stalls: [] };
              new PerformanceObserver(list => window.tablePerf.stalls.push(...list.getEntries()
                .filter(entry => entry.startTime >= window.tablePerf.start).map(entry => entry.duration)))
                .observe({ type: 'longtask' });
              editor.addEventListener('keydown', event => {
                if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
                const start = performance.now();
                requestAnimationFrame(() => window.tablePerf.keys.push(performance.now() - start));
              });
            })()
          JAVASCRIPT
          page.driver.browser.action.send_keys(TABLE_BURST).perform
          table = page.evaluate_async_script(<<~JAVASCRIPT)
            const done = arguments[arguments.length - 1];
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => done(window.tablePerf), 100)));
          JAVASCRIPT
          before_table = source + BURST
          insertion = before_table.rindex("| queue worker") + "| queue worker".length
          assert_equal before_table[0...insertion] + TABLE_BURST + before_table[insertion..],
            page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
          assert_equal TABLE_BURST.length, table.fetch("keys").length, "every table character is measured"
          assert_selector ".continuous-document .cm-continuous-cell", text: "queue worker revised quickly"
          report[:table] = {
            input_ms: table.fetch("keys").map { |value| value.round(1) },
            input_p95_ms: p95(table.fetch("keys")).round(1),
            long_tasks_ms: table.fetch("stalls").map { |value| value.round(1) }
          }
        end
        next unless name == "math_heavy"

        # Type real TeX inside an existing equation in the long document.
        # Positioning is setup; the subsequent native keyboard burst runs
        # continuously and must preserve every character without repair.
        page.evaluate_script(<<~JAVASCRIPT)
          (() => {
            const editor = document.querySelector('.source-field').editorController;
            const position = editor.view.state.doc.toString().lastIndexOf('$f(x)') + '$f(x)'.length;
            if (position < '$f(x)'.length) throw new Error('The frozen equation was not found');
            editor.view.dispatch({ selection: { anchor: position } });
            editor.view.focus();
          })()
        JAVASCRIPT
        page.evaluate_async_script("const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(done));")
        page.evaluate_script(<<~JAVASCRIPT)
          (() => {
            const editor = document.querySelector('.continuous-document .cm-content');
            window.equationPerf = { start: performance.now(), keys: [], stalls: [] };
            new PerformanceObserver(list => window.equationPerf.stalls.push(...list.getEntries()
              .filter(entry => entry.startTime >= window.equationPerf.start).map(entry => entry.duration)))
              .observe({ type: 'longtask' });
            editor.addEventListener('keydown', event => {
              if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
              const start = performance.now();
              requestAnimationFrame(() => window.equationPerf.keys.push(performance.now() - start));
            });
          })()
        JAVASCRIPT
        page.driver.browser.action.send_keys(EQUATION_BURST).perform
        equation = page.evaluate_async_script(<<~JAVASCRIPT)
          const done = arguments[arguments.length - 1];
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => done(window.equationPerf), 100)));
        JAVASCRIPT
        before_equation = source + BURST
        insertion = before_equation.rindex("$f(x)") + "$f(x)".length
        assert_equal before_equation[0...insertion] + EQUATION_BURST + before_equation[insertion..],
          page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
        assert_equal EQUATION_BURST.length, equation.fetch("keys").length, "every equation character is measured"
        report[:equation] = {
          input_ms: equation.fetch("keys").map { |value| value.round(1) },
          input_p95_ms: p95(equation.fetch("keys")).round(1),
          long_tasks_ms: equation.fetch("stalls").map { |value| value.round(1) }
        }

        # Creating an equation starts with an unmatched delimiter, unlike
        # editing a closed expression. Measure the whole uninterrupted path.
        page.driver.browser.action.key_down(:control).send_keys(:end).key_up(:control).perform
        page.evaluate_async_script("const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(done));")
        page.evaluate_script(<<~JAVASCRIPT)
          (() => {
            const editor = document.querySelector('.continuous-document .cm-content');
            window.newEquationPerf = { start: performance.now(), keys: [], stalls: [] };
            new PerformanceObserver(list => window.newEquationPerf.stalls.push(...list.getEntries()
              .filter(entry => entry.startTime >= window.newEquationPerf.start).map(entry => entry.duration)))
              .observe({ type: 'longtask' });
            editor.addEventListener('keydown', event => {
              if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
              const start = performance.now();
              requestAnimationFrame(() => window.newEquationPerf.keys.push(performance.now() - start));
            });
          })()
        JAVASCRIPT
        page.driver.browser.action.send_keys(NEW_EQUATION_BURST).perform
        new_equation = page.evaluate_async_script(<<~JAVASCRIPT)
          const done = arguments[arguments.length - 1];
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => done(window.newEquationPerf), 100)));
        JAVASCRIPT
        after_equation = before_equation[0...insertion] + EQUATION_BURST + before_equation[insertion..]
        assert_equal after_equation + NEW_EQUATION_BURST, page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
        assert_equal NEW_EQUATION_BURST.length, new_equation.fetch("keys").length, "every new equation character is measured"
        report[:new_equation] = {
          input_ms: new_equation.fetch("keys").map { |value| value.round(1) },
          input_p95_ms: p95(new_equation.fetch("keys")).round(1),
          long_tasks_ms: new_equation.fetch("stalls").map { |value| value.round(1) }
        }

        # Repeat in a standalone paragraph near the middle, with many later
        # equations and tables still present in the document.
        current_source = after_equation + NEW_EQUATION_BURST
        marker = "Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly."
        middle = current_source.index(marker, current_source.length / 2)
        assert middle, "math-heavy: middle paragraph exists"
        middle += marker.length
        page.evaluate_script(<<~JAVASCRIPT, middle)
          ((position) => {
            const editor = document.querySelector('.source-field').editorController;
            editor.view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
            editor.view.focus();
          })(arguments[0])
        JAVASCRIPT
        page.evaluate_async_script("const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(done));")
        page.evaluate_script(<<~JAVASCRIPT)
          (() => {
            const editor = document.querySelector('.continuous-document .cm-content');
            window.middleEquationPerf = { start: performance.now(), keys: [], stalls: [] };
            new PerformanceObserver(list => window.middleEquationPerf.stalls.push(...list.getEntries()
              .filter(entry => entry.startTime >= window.middleEquationPerf.start).map(entry => entry.duration)))
              .observe({ type: 'longtask' });
            editor.addEventListener('keydown', event => {
              if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
              const start = performance.now();
              requestAnimationFrame(() => window.middleEquationPerf.keys.push(performance.now() - start));
            });
          })()
        JAVASCRIPT
        page.driver.browser.action.send_keys(NEW_EQUATION_BURST).perform
        middle_equation = page.evaluate_async_script(<<~JAVASCRIPT)
          const done = arguments[arguments.length - 1];
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => done(window.middleEquationPerf), 100)));
        JAVASCRIPT
        assert_equal current_source[0...middle] + NEW_EQUATION_BURST + current_source[middle..],
          page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
        assert_equal NEW_EQUATION_BURST.length, middle_equation.fetch("keys").length, "every middle equation character is measured"
        report[:middle_equation] = {
          input_ms: middle_equation.fetch("keys").map { |value| value.round(1) },
          input_p95_ms: p95(middle_equation.fetch("keys")).round(1),
          long_tasks_ms: middle_equation.fetch("stalls").map { |value| value.round(1) }
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
    assert_operator report.fetch(:equation).fetch(:input_p95_ms), :<=, 50, "math-heavy: equation input p95"
    assert_empty report.fetch(:equation).fetch(:long_tasks_ms).select { |duration| duration > 100 }, "math-heavy: equation authoring stalls over 100ms"
    assert_operator report.fetch(:new_equation).fetch(:input_p95_ms), :<=, 50, "math-heavy: new equation input p95"
    assert_empty report.fetch(:new_equation).fetch(:long_tasks_ms).select { |duration| duration > 100 }, "math-heavy: new equation authoring stalls over 100ms"
    assert_operator report.fetch(:middle_equation).fetch(:input_p95_ms), :<=, 50, "math-heavy: middle equation input p95"
    assert_empty report.fetch(:middle_equation).fetch(:long_tasks_ms).select { |duration| duration > 100 }, "math-heavy: middle equation authoring stalls over 100ms"
    assert_operator report.fetch(:table).fetch(:input_p95_ms), :<=, 50, "mixed: table input p95"
    assert_empty report.fetch(:table).fetch(:long_tasks_ms).select { |duration| duration > 100 }, "mixed: table authoring stalls over 100ms"
  end if ENV["ELEF_PERF_MODE"] == "continuous"
end
