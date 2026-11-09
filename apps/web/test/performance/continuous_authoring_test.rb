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
            window.startAuthoringPerf = () => {
              window.stopAuthoringPerf?.();
              const editor = document.querySelector('.continuous-document .cm-content');
              const perf = { start: performance.now(), keys: [], stalls: [], keyEvents: [], stallDetails: [], longFrames: [] };
              const observer = new PerformanceObserver(list => {
                for (const entry of list.getEntries()) {
                  if (entry.startTime < perf.start) continue;
                  perf.stalls.push(entry.duration);
                  perf.stallDetails.push({ start: entry.startTime - perf.start, duration: entry.duration, name: entry.name,
                    attribution: entry.attribution.map(item => ({ name: item.name, containerType: item.containerType })) });
                }
              });
              observer.observe({ type: 'longtask' });
              // Long tasks alone do not identify the work that delayed a
              // frame. Capture browser-provided script/layout attribution
              // when available, without changing the latency budgets.
              const frameObserver = PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')
                ? new PerformanceObserver(list => {
                    for (const entry of list.getEntries()) {
                      if (entry.startTime < perf.start) continue;
                      perf.longFrames.push({ start: entry.startTime - perf.start, duration: entry.duration,
                        blocking: entry.blockingDuration, renderStart: entry.renderStart - perf.start,
                        styleAndLayoutStart: entry.styleAndLayoutStart - perf.start,
                        scripts: entry.scripts.map(script => ({ start: script.startTime - perf.start,
                          duration: script.duration, source: script.sourceURL, function: script.sourceFunctionName,
                          position: script.sourceCharPosition, invoker: script.invoker,
                          forcedLayout: script.forcedStyleAndLayoutDuration })) });
                    }
                  })
                : null;
              frameObserver?.observe({ type: 'long-animation-frame' });
              const keydown = event => {
                if (!editor.contains(event.target) || event.ctrlKey || event.metaKey || event.altKey ||
                    (event.key.length !== 1 && !['Enter', 'Backspace'].includes(event.key))) return;
                const start = performance.now();
                const sample = { key: event.key, start: start - perf.start };
                perf.keyEvents.push(sample);
                requestAnimationFrame(() => { sample.frame = performance.now() - start; perf.keys.push(sample.frame); });
              };
              // Listen before editor capture/keymap handlers, so their work
              // is included rather than hidden before the measurement starts.
              document.addEventListener('keydown', keydown, true);
              window.stopAuthoringPerf = () => { observer.disconnect(); frameObserver?.disconnect(); document.removeEventListener('keydown', keydown, true); };
              return perf;
            };
            window.continuousPerf = window.startAuthoringPerf();
            return true;
          })()
        JAVASCRIPT
        assert supported, "#{name}: browser must expose long-task measurements"
        if name == "math_heavy"
          page.driver.browser.execute_cdp("Profiler.enable")
          @profile_browser_start = page.evaluate_script("performance.now()")
          page.driver.browser.execute_cdp("Profiler.start")
        end
        page.driver.browser.action.send_keys(BURST).perform
        measurements = page.evaluate_async_script(<<~JAVASCRIPT)
          const done = arguments[arguments.length - 1];
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { window.stopAuthoringPerf(); done(window.continuousPerf); }, 100)));
        JAVASCRIPT
        assert_equal source + BURST, page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
        assert_equal BURST.length, measurements.fetch("keys").length, "#{name}: every typed character is measured"
        report[:fixtures][name] = {
          open_ms: opens.map { |value| value.round(1) }, open_p95_ms: p95(opens).round(1),
          input_ms: measurements.fetch("keys").map { |value| value.round(1) },
          input_p95_ms: p95(measurements.fetch("keys")).round(1),
          long_tasks_ms: measurements.fetch("stalls").map { |value| value.round(1) },
          long_task_details: measurements.fetch("stallDetails"), long_frame_details: measurements.fetch("longFrames"), key_events: measurements.fetch("keyEvents")
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
          page.evaluate_script("window.tablePerf = window.startAuthoringPerf()")
          page.driver.browser.action.send_keys(TABLE_BURST).perform
          table = page.evaluate_async_script(<<~JAVASCRIPT)
            const done = arguments[arguments.length - 1];
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { window.stopAuthoringPerf(); done(window.tablePerf); }, 100)));
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
            long_tasks_ms: table.fetch("stalls").map { |value| value.round(1) },
            long_task_details: table.fetch("stallDetails"), long_frame_details: table.fetch("longFrames"), key_events: table.fetch("keyEvents")
          }
        end
        next unless name == "math_heavy"

        # Splitting and joining a paragraph must remain responsive too. Both
        # keys run through the editor's real keymap with no pacing or repair.
        marker = "Two masses joined by springs exchange energy at the beat frequency. The normal modes diagonalize the motion cleanly."
        paragraph = source.index(marker, source.length / 2)
        assert paragraph, "math-heavy: middle paragraph exists"
        paragraph += marker.length
        page.evaluate_script(<<~JAVASCRIPT, paragraph)
          ((position) => {
            const editor = document.querySelector('.source-field').editorController;
            editor.view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
            editor.view.focus();
          })(arguments[0])
        JAVASCRIPT
        page.evaluate_async_script("const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(done));")
        page.evaluate_script("window.paragraphPerf = window.startAuthoringPerf()")
        page.driver.browser.action.send_keys(*Array.new(10) { [ :enter, :backspace ] }.flatten).perform
        paragraph_measurements = page.evaluate_async_script(<<~JAVASCRIPT)
          const done = arguments[arguments.length - 1];
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { window.stopAuthoringPerf(); done(window.paragraphPerf); }, 100)));
        JAVASCRIPT
        assert_equal source + BURST, page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
        assert_equal 20, paragraph_measurements.fetch("keys").length, "every paragraph split and join is measured"
        report[:paragraph] = {
          input_ms: paragraph_measurements.fetch("keys").map { |value| value.round(1) },
          input_p95_ms: p95(paragraph_measurements.fetch("keys")).round(1),
          long_tasks_ms: paragraph_measurements.fetch("stalls").map { |value| value.round(1) },
          long_task_details: paragraph_measurements.fetch("stallDetails"), long_frame_details: paragraph_measurements.fetch("longFrames"), key_events: paragraph_measurements.fetch("keyEvents")
        }

        # Type real TeX inside an existing equation in the long document.
        # Positioning is setup; the subsequent native keyboard burst runs
        # continuously and must preserve every character without repair.
        page.evaluate_script(<<~JAVASCRIPT)
          (() => {
            const editor = document.querySelector('.source-field').editorController;
            const position = editor.view.state.doc.toString().lastIndexOf('$f(x)') + '$f(x)'.length;
            if (position < '$f(x)'.length) throw new Error('The frozen equation was not found');
            editor.view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
            editor.view.focus();
          })()
        JAVASCRIPT
        page.evaluate_async_script("const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(done));")
        page.evaluate_script("window.equationPerf = window.startAuthoringPerf()")
        page.driver.browser.action.send_keys(EQUATION_BURST).perform
        equation = page.evaluate_async_script(<<~JAVASCRIPT)
          const done = arguments[arguments.length - 1];
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { window.stopAuthoringPerf(); done(window.equationPerf); }, 100)));
        JAVASCRIPT
        before_equation = source + BURST
        insertion = before_equation.rindex("$f(x)") + "$f(x)".length
        assert_equal before_equation[0...insertion] + EQUATION_BURST + before_equation[insertion..],
          page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
        assert_equal EQUATION_BURST.length, equation.fetch("keys").length, "every equation character is measured"
        report[:equation] = {
          input_ms: equation.fetch("keys").map { |value| value.round(1) },
          input_p95_ms: p95(equation.fetch("keys")).round(1),
          long_tasks_ms: equation.fetch("stalls").map { |value| value.round(1) },
          long_task_details: equation.fetch("stallDetails"), long_frame_details: equation.fetch("longFrames"), key_events: equation.fetch("keyEvents")
        }

        # Creating an equation starts with an unmatched delimiter, unlike
        # editing a closed expression. Measure the whole uninterrupted path.
        page.driver.browser.action.key_down(:control).send_keys(:end).key_up(:control).perform
        page.evaluate_async_script("const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(done));")
        page.evaluate_script("window.newEquationPerf = window.startAuthoringPerf()")
        page.driver.browser.action.send_keys(NEW_EQUATION_BURST).perform
        new_equation = page.evaluate_async_script(<<~JAVASCRIPT)
          const done = arguments[arguments.length - 1];
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { window.stopAuthoringPerf(); done(window.newEquationPerf); }, 100)));
        JAVASCRIPT
        after_equation = before_equation[0...insertion] + EQUATION_BURST + before_equation[insertion..]
        assert_equal after_equation + NEW_EQUATION_BURST, page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
        assert_equal NEW_EQUATION_BURST.length, new_equation.fetch("keys").length, "every new equation character is measured"
        report[:new_equation] = {
          input_ms: new_equation.fetch("keys").map { |value| value.round(1) },
          input_p95_ms: p95(new_equation.fetch("keys")).round(1),
          long_tasks_ms: new_equation.fetch("stalls").map { |value| value.round(1) },
          long_task_details: new_equation.fetch("stallDetails"), long_frame_details: new_equation.fetch("longFrames"), key_events: new_equation.fetch("keyEvents")
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
        page.evaluate_script("window.middleEquationPerf = window.startAuthoringPerf()")
        page.driver.browser.action.send_keys(NEW_EQUATION_BURST).perform
        middle_equation = page.evaluate_async_script(<<~JAVASCRIPT)
          const done = arguments[arguments.length - 1];
          requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { window.stopAuthoringPerf(); done(window.middleEquationPerf); }, 100)));
        JAVASCRIPT
        # Diagnostic only: repeat complete unpaced equation creation in
        # separate paragraphs while retaining the same long-document editor.
        diagnostic_source = current_source[0...middle] + NEW_EQUATION_BURST + current_source[middle..]
        diagnostic_runs = []
        search_from = 0
        15.times do |iteration|
          position = diagnostic_source.index(marker, search_from)
          raise "missing diagnostic paragraph #{iteration}" unless position
          position += marker.length
          page.evaluate_script(<<~JAVASCRIPT, position)
            ((position) => {
              const editor = document.querySelector('.source-field').editorController;
              editor.view.dispatch({ selection: { anchor: position }, scrollIntoView: true });
              editor.view.focus();
            })(arguments[0])
          JAVASCRIPT
          page.evaluate_async_script("const done = arguments[arguments.length - 1]; requestAnimationFrame(() => requestAnimationFrame(done));")
          page.evaluate_script("window.extraEquationPerf = window.startAuthoringPerf()")
          page.driver.browser.action.send_keys(NEW_EQUATION_BURST).perform
          diagnostic_runs << page.evaluate_async_script(<<~JAVASCRIPT)
            const done = arguments[arguments.length - 1];
            requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => { window.stopAuthoringPerf(); done(window.extraEquationPerf); }, 50)));
          JAVASCRIPT
          diagnostic_source = diagnostic_source[0...position] + NEW_EQUATION_BURST + diagnostic_source[position..]
          search_from = position + NEW_EQUATION_BURST.length
        end
        assert_equal diagnostic_source, page.evaluate_script("document.querySelector('.source-field').editorController.sourceValue")
        profile = page.driver.browser.execute_cdp("Profiler.stop").fetch("profile")
        File.write(ENV.fetch("ELEF_CONTINUOUS_CPU_PROFILE"), JSON.generate(profile))
        File.write(ENV.fetch("ELEF_CONTINUOUS_CPU_PROFILE").sub(".cpuprofile", ".json"), JSON.generate({ profile_start: @profile_browser_start, runs: diagnostic_runs }))
        assert_equal NEW_EQUATION_BURST.length, middle_equation.fetch("keys").length, "every middle equation character is measured"
        report[:middle_equation] = {
          input_ms: middle_equation.fetch("keys").map { |value| value.round(1) },
          input_p95_ms: p95(middle_equation.fetch("keys")).round(1),
          long_tasks_ms: middle_equation.fetch("stalls").map { |value| value.round(1) },
          long_task_details: middle_equation.fetch("stallDetails"), long_frame_details: middle_equation.fetch("longFrames"), key_events: middle_equation.fetch("keyEvents")
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
    assert_operator report.fetch(:paragraph).fetch(:input_p95_ms), :<=, 50, "math-heavy: paragraph split and join p95"
    assert_empty report.fetch(:paragraph).fetch(:long_tasks_ms).select { |duration| duration > 100 }, "math-heavy: paragraph split and join stalls over 100ms"
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
