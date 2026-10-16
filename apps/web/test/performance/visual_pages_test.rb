require "application_system_test_case"
require "digest"
require "json"
require "fileutils"

# Visual-editor page benchmark for the two frozen 100-page fixtures.
#
# This file is NOT part of the default system suite (test/performance is not
# globbed by `bin/rails test test/system`); run it explicitly:
#
#   ELEF_PERF_MODE=calibrate ELEF_PERF_SOURCE=/path/to.md \
#     bin/rails test test/performance/visual_pages_test.rb
#
# Modes:
# - calibrate: load ELEF_PERF_SOURCE once, wait for settled pagination, print
#   a PERF_CALIBRATE JSON line (page count, DOM size, math/image status).
# - measure (default): full 20-sample open/input benchmark, writes a JSON
#   report (ELEF_PERF_REPORT path or /tmp) and prints a summary.
#
# Reference layout (recorded in the report): headless Chrome, 1400x1000,
# deviceScaleFactor 1, fixture frontmatter theme/typography, fonts settled.
class VisualPagesTest < ApplicationSystemTestCase
  FIXTURE_DIR = File.expand_path("../fixtures/performance", __dir__).freeze
  MIXED_FIXTURE = File.join(FIXTURE_DIR, "elef-visual-100-mixed.md").freeze
  MATH_FIXTURE = File.join(FIXTURE_DIR, "elef-visual-100-math.md").freeze
  ASSETS_DIR = File.join(FIXTURE_DIR, "assets").freeze
  OPEN_SAMPLES = 20
  SETTLE_TIMEOUT = 180

  PROBE_SCRIPT = <<~JAVASCRIPT.freeze
    window.__elefPerf = { t0: performance.now(), paginatedAt: [], previewTrace: [], lastLongtaskEnd: 0, longtaskCount: 0 };
    window.__elefPreviewTrace = window.__elefPerf.previewTrace;
    document.addEventListener("elef:document-paginated", () => {
      window.__elefPerf.paginatedAt.push(performance.now());
    });
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__elefPerf.lastLongtaskEnd = entry.startTime + entry.duration;
          window.__elefPerf.longtaskCount += 1;
        }
      }).observe({ entryTypes: ["longtask"] });
    } catch (_error) { /* longtask unsupported; quiet gates stay permissive */ }
  JAVASCRIPT

  SETTLE_SCRIPT = <<~JAVASCRIPT.freeze
    (() => {
      const surface = document.querySelector(".document-editor-projection .document-surface")
        || document.querySelector(".document-surface");
      const form = document.querySelector("form.visual-editor-form");
      if (!surface || !form) return null;
      const fresh = form.matches("form.visual-editor-form:not([data-preview-projection-stale='true'])");
      const settled = surface.dataset.documentPagesSettled === "true";
      const editor = document.querySelector(".source-field")?.editorController;
      const editable = Boolean(editor) && Boolean(surface.querySelector("[contenteditable='true']"));
      const fonts = !document.fonts || document.fonts.status === "loaded";
      const images = [...surface.querySelectorAll("img")];
      const imagesReady = images.every((img) => img.complete && img.naturalWidth > 0);
      return {
        settled, fresh, editable, fonts, imagesReady,
        pages: surface.querySelectorAll(".document-page").length,
        quietMs: performance.now() - (window.__elefPerf?.lastLongtaskEnd || 0),
        longtasks: window.__elefPerf?.longtaskCount || 0,
        now: performance.now()
      };
    })()
  JAVASCRIPT

  BREAKDOWN_SCRIPT = <<~JAVASCRIPT.freeze
    (() => {
      const nav = performance.getEntriesByType("navigation")[0] || {};
      const paints = performance.getEntriesByType("paint") || [];
      const paint = (name) => (paints.find((entry) => entry.name === name) || {}).startTime ?? null;
      const resources = performance.getEntriesByType("resource") || [];
      const byType = {};
      resources.forEach((entry) => {
        const key = entry.initiatorType || "other";
        byType[key] = byType[key] || { count: 0, total: 0 };
        byType[key].count += 1;
        byType[key].total += entry.responseEnd - entry.startTime;
      });
      const slowest = resources
        .map((entry) => ({ name: entry.name.split("/").slice(-1)[0].slice(0, 60), ms: Math.round(entry.responseEnd - entry.startTime), end: Math.round(entry.responseEnd) }))
        .sort((a, b) => b.end - a.end)
        .slice(0, 8);
      const marks = (performance.getEntriesByType("mark") || [])
        .filter((entry) => entry.name.startsWith("elef:"))
        .map((entry) => ({ name: entry.name.slice(5), t: entry.startTime }));
      const stages = [];
      const pending = {};
      marks.forEach((mark) => {
        if (mark.name.endsWith("-start")) pending[mark.name.slice(0, -6)] = mark.t;
        else if (mark.name.endsWith("-end")) {
          const key = mark.name.slice(0, -4);
          if (pending[key] === undefined) return;
          stages.push({ stage: key, start: Math.round(pending[key]), end: Math.round(mark.t), ms: Math.round((mark.t - pending[key]) * 10) / 10 });
          delete pending[key];
        }
      });
      return {
        t0: window.__elefPerf?.t0 ?? null,
        navigationStart: nav.startTime ?? 0,
        requestStart: nav.requestStart ?? null,
        responseStart: nav.responseStart ?? null,
        responseEnd: nav.responseEnd ?? null,
        domInteractive: nav.domInteractive ?? null,
        transferBytes: nav.transferSize ?? null,
        domContentLoaded: nav.domContentLoadedEventEnd ?? null,
        loadEvent: nav.loadEventEnd ?? null,
        stages,
        orphanStageStarts: Object.keys(pending),
        firstPaint: paint("first-paint"),
        firstContentfulPaint: paint("first-contentful-paint"),
        paginatedAt: window.__elefPerf?.paginatedAt ?? [],
        previewTrace: (window.__elefPerf?.previewTrace || []).slice(-14),
        resourceTypes: byType,
        slowestResources: slowest,
        pages: document.querySelectorAll(".document-page").length,
        domNodes: document.getElementsByTagName("*").length,
        katex: document.querySelectorAll(".document-surface .katex").length,
        katexDisplay: document.querySelectorAll(".document-surface .katex-display").length,
        katexErrors: document.querySelectorAll(".document-surface .math-error").length,
        mathSource: document.querySelectorAll(".document-surface [data-editor-math-source]").length,
        dollarRuns: (document.querySelector(".document-surface")?.textContent.match(/\\$+/g) || []).length,
        errorText: document.body.textContent.includes("<<ERROR>>"),
        images: [...document.querySelectorAll(".document-surface img")].length,
        imgSample: [...document.querySelectorAll(".document-surface img")].slice(0, 3).map((img) => ({
          src: (img.getAttribute("src") || "").slice(0, 80),
          complete: img.complete,
          naturalWidth: img.naturalWidth
        }))
      };
    })()
  JAVASCRIPT

  def install_perf_probes
    page.driver.browser.execute_cdp(
      "Page.addScriptToEvaluateOnNewDocument", source: PROBE_SCRIPT
    )
    # The stock driver script timeout is 2s; in-page probe timers run to 8s
    # and a 100-page pagination pass blocks the main thread for seconds, so
    # both install and await scripts need headroom. Failures still surface
    # loudly via the in-page -1s and the settle-loop deadline.
    page.driver.browser.manage.timeouts.script = 30
  end

  def create_perf_document(name, source)
    document = Document.create!(title: name, source: source)
    Dir.glob(File.join(ASSETS_DIR, "*")).sort.each do |path|
      filename = File.basename(path)
      next unless source.include?(filename)

      document.assets.attach(
        io: File.open(path, "rb"),
        filename: filename,
        content_type: Rack::Mime.mime_type(File.extname(path))
      )
    end
    document
  end

  # Returns [wall_seconds, breakdown] once the page is settled+fresh+editable
  # with fonts and images ready, or raises with the last observed state.
  def measure_open(document, gate_images: true)
    t0 = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    visit edit_document_path(document)
    state = nil
    deadline = t0 + SETTLE_TIMEOUT
    loop do
      state = page.evaluate_script(SETTLE_SCRIPT)
      break if state && state["settled"] && state["fresh"] && state["editable"] &&
        state["fonts"] && (!gate_images || state["imagesReady"])

      now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      raise "visual pages never settled: #{state.inspect}" if now > deadline

      sleep 0.1
    end
    wall = Process.clock_gettime(Process::CLOCK_MONOTONIC) - t0
    [wall, page.evaluate_script(BREAKDOWN_SCRIPT)]
  end

  def p50(samples)
    return nil if samples.empty?

    sorted = samples.sort
    sorted[[(sorted.length * 0.5).ceil - 1, 0].max]
  end

  def p95(samples)
    return nil if samples.empty?

    sorted = samples.sort
    sorted[[(sorted.length * 0.95).ceil - 1, 0].max]
  end

  def summarize(samples)
    return {} if samples.empty?

    { count: samples.length, p50_ms: p50(samples)&.round(1), p95_ms: p95(samples)&.round(1),
      max_ms: samples.max.round(1), min_ms: samples.min.round(1) }
  end

  def fresh_browser
    page.driver.quit
    page.driver.browser.navigate.to("about:blank")
    install_perf_probes
  end

  def env_info
    mem_kb = File.read("/proc/meminfo")[/MemTotal:\s+(\d+)/, 1].to_i
    {
      ruby: RUBY_VERSION,
      rails_env: Rails.env,
      ci_runner: ENV["ELEF_PERF_RUNNER"],
      sqlite: ENV["ELEF_USE_SQLITE"] == "1",
      hardware: "#{`nproc`.strip} cores, #{(mem_kb / 1024 / 1024.0).round(1)}GB RAM, #{`uname -m`.strip}",
      network: "loopback Puma test server",
      build_profile: "test (unminified assets served per-request)",
      git_sha: `git rev-parse --short HEAD`.strip,
      viewport: page.evaluate_script("[window.innerWidth, window.innerHeight]"),
      user_agent: page.evaluate_script("navigator.userAgent")
    }
  end

  # One-shot in-page latency probe: installs window.__perfSample promise,
  # yields to Ruby for the stimulus, then awaits the measured milliseconds
  # (or -1 on timeout). Measurement runs entirely in-page (no webdriver
  # round-trip inside the measured interval).
  #
  # HARD RULE (verified empirically on chromedriver 152): sync
  # evaluate_script/execute_script executes ONLY the first top-level
  # statement. Every multi-step script MUST be a single-statement IIFE with
  # an explicit return. (CDP document-start scripts are unaffected.)
  # Returns [ms, flags, trace]. Flags: "clean", "overlap" (a paginate,
  # install, or preview-handler stage ran during the sample),
  # "watchdog"/"completion" (timeouts, ms == -1). The completion timer arms
  # on the STIMULUS, not on
  # install: webdriver dispatch plus page busyness routinely take seconds to
  # deliver the stimulus, and that delivery latency is harness overhead, not
  # input latency.
  def measure_sample(install_script)
    page.evaluate_script(install_script)
    yield
    # Native async call: Capybara's wrapper clamps the session script
    # timeout to default_max_wait_time (2s) on every call, which would
    # behead the probe's 25s watchdog. install_perf_probes sets 30s.
    raw = page.driver.browser.execute_async_script("window.__perfSample.then(arguments[arguments.length - 1]);")
    ms_str, flags = raw.to_s.split("|", 2)
    trace = page.evaluate_script("JSON.stringify(window.__perfTrace || null)")
    [ms_str.to_f, flags || "", trace]
  end

  def record_input_sample(samples, stalls, overlaps, category, name, index, ms, flags, trace)
    puts "PERF_SAMPLE input=#{category} n=#{index + 1} ms=#{ms.round(1)} flags=#{flags}"
    puts "PERF_TIMEOUT trace=#{trace}" if ms == -1
    samples << ms
    stalls << { category: category, fixture: name, index: index, ms: ms.round(1), flags: flags } if ms > 100
    overlaps << { category: category, fixture: name, index: index, ms: ms.round(1) } if flags.include?("overlap")
  end

  # Shared probe scaffolding: stimulus-armed completion timer (5s), 25s
  # watchdog under the 30s driver timeout, and stage overlap detection via
  # elef: marks (paginate, projection install, preview stale/updated
  # handler work). Resolves "ms|flags".
  PROBE_SCAFFOLD = <<~JAVASCRIPT.freeze
    window.__perfTrace = [`install@${Math.round(performance.now())}:ae=${document.activeElement?.tagName}`];
    const stageMarks = () => {
      const marks = performance.getEntriesByType("mark") || [];
      let starts = 0, ends = 0;
      marks.forEach((mark) => {
        if (mark.name === "elef:paginate-start" || mark.name === "elef:projection-install-start" ||
            mark.name === "elef:preview-stale-start" || mark.name === "elef:preview-updated-start") starts += 1;
        else if (mark.name === "elef:paginate-end" || mark.name === "elef:projection-install-end" ||
            mark.name === "elef:preview-stale-end" || mark.name === "elef:preview-updated-end") ends += 1;
      });
      return { starts, ends };
    };
    const before = stageMarks();
    const overlapFlag = () => {
      const after = stageMarks();
      return (before.starts > before.ends || after.starts > before.starts) ? "overlap" : "clean";
    };
    // Assign, never return: a sync evaluate_script awaits a returned
    // promise, so returning it would stall the install until the 25s
    // watchdog and poison every sample. Installs are bare IIFEs.
    window.__perfSample = new Promise((resolve) => {
      const watchdog = setTimeout(() => resolve("-1|watchdog"), 25000);
      let completion = 0;
      const finish = (ms) => {
        clearTimeout(watchdog);
        clearTimeout(completion);
        window.__perfTrace.push(`done@${Math.round(performance.now())}:${overlapFlag()}`);
        resolve(`${ms}|${overlapFlag()}`);
      };
      const arm = () => {
        const t0 = performance.now();
        completion = setTimeout(() => {
          clearTimeout(watchdog);
          window.__perfTrace.push("completion-timeout");
          resolve("-1|completion");
        }, 5000);
        return t0;
      };
  JAVASCRIPT

  KEY_PAINT_INSTALL = <<~JAVASCRIPT.freeze
    (() => {
      #{PROBE_SCAFFOLD}
        const onKey = (event) => {
          if (event.type !== "keydown") return;
          window.__perfTrace.push(`kd:${event.key}@${Math.round(performance.now())}:ae=${document.activeElement?.tagName}`);
          const t0 = arm();
          document.removeEventListener("keydown", onKey, true);
          const onInput = () => {
            document.removeEventListener("input", onInput, true);
            window.__perfTrace.push(`in@${Math.round(performance.now())}`);
            requestAnimationFrame(() => requestAnimationFrame(() => finish(performance.now() - t0)));
          };
          document.addEventListener("input", onInput, true);
        };
        document.addEventListener("keydown", onKey, true);
      });
    })();
  JAVASCRIPT

  MOTION_PAINT_INSTALL = <<~JAVASCRIPT.freeze
    (() => {
      #{PROBE_SCAFFOLD}
        const onKey = (event) => {
          if (event.type !== "keydown") return;
          window.__perfTrace.push(`kd:${event.key}@${Math.round(performance.now())}`);
          const t0 = arm();
          document.removeEventListener("keydown", onKey, true);
          const onSel = () => {
            document.removeEventListener("selectionchange", onSel);
            window.__perfTrace.push(`sel@${Math.round(performance.now())}`);
            requestAnimationFrame(() => requestAnimationFrame(() => finish(performance.now() - t0)));
          };
          document.addEventListener("selectionchange", onSel);
        };
        document.addEventListener("keydown", onKey, true);
      });
    })();
  JAVASCRIPT

  REVEAL_PAINT_INSTALL = <<~JAVASCRIPT.freeze
    (() => {
      #{PROBE_SCAFFOLD}
        const onClick = () => {
          const t0 = arm();
          window.__perfTrace.push(`click@${Math.round(t0)}`);
          document.removeEventListener("click", onClick, true);
          const observer = new MutationObserver(() => {
            if (!document.querySelector(".editor-math-active")) return;
            observer.disconnect();
            window.__perfTrace.push(`active@${Math.round(performance.now())}`);
            requestAnimationFrame(() => requestAnimationFrame(() => finish(performance.now() - t0)));
          });
          observer.observe(document.querySelector(".document-surface"), { childList: true, subtree: true });
        };
        document.addEventListener("click", onClick, true);
      });
    })();
  JAVASCRIPT

  SUGGEST_PAINT_INSTALL = <<~JAVASCRIPT.freeze
    (() => {
      const seen = new Set();
      document.querySelectorAll(".snippet-option").forEach((node) => seen.add(node));
      #{PROBE_SCAFFOLD}
        window.__perfTrace.push(`seen=${seen.size}`);
        let t0 = 0;
        let armed = false;
        const onKey = (event) => {
          if (event.type !== "keydown") return;
          if (!armed) { armed = true; arm(); }
          t0 = performance.now();
          window.__perfTrace.push(`kd:${event.key}@${Math.round(t0)}`);
        };
        document.addEventListener("keydown", onKey, true);
        const observer = new MutationObserver(() => {
          const option = [...document.querySelectorAll(".snippet-palette:not([hidden]) .snippet-option")]
            .find((node) => !seen.has(node));
          if (!option) return;
          observer.disconnect();
          document.removeEventListener("keydown", onKey, true);
          window.__perfTrace.push(`opt@${Math.round(performance.now())}`);
          requestAnimationFrame(() => requestAnimationFrame(() => finish(performance.now() - t0)));
        });
        observer.observe(document.body, { childList: true, subtree: true });
      });
    })();
  JAVASCRIPT

  def benchmark_open(samples, kind)
    walls = []
    breakdowns = []
    samples.times do |index|
      # fresh_browser quits the driver (clearing document-start scripts) and
      # reinstalls probes; repeat samples reuse the last first-open browser
      # whose probes are still installed. Never double-install: the
      # paginated listener would record each pass twice.
      fresh_browser if kind == :first
      yield
      wall, breakdown = measure_open(@perf_document)
      walls << (wall * 1000)
      breakdowns << breakdown
      server_ms = ((breakdown["responseStart"] || 0) - (breakdown["requestStart"] || 0)).round(0)
      stages = (breakdown["stages"] || []).map { |s| "#{s["stage"]}=#{s["ms"].round(0)}" }.join(" ")
      puts "PERF_SAMPLE open=#{kind} n=#{index + 1} ms=#{(wall * 1000).round(0)} pages=#{breakdown["pages"]} " \
        "server=#{server_ms} dcl=#{(breakdown["domContentLoaded"] || 0).round(0)} #{stages}"
    end
    [walls, breakdowns]
  end

  def benchmark_fixture(name, source)
    smoke = ENV["ELEF_PERF_SMOKE"] == "1"
    open_n = ENV["ELEF_PERF_OPEN_N"].to_i
    open_n = (smoke ? 2 : OPEN_SAMPLES) if open_n <= 0
    only = ENV["ELEF_PERF_ONLY"]
    result = { source_bytes: source.bytesize }
    stalls = []
    overlaps = []

    if only.nil? || only.include?("open")
      @perf_document = create_perf_document("Perf #{name} open", source)
      first_walls, first_breakdowns = benchmark_open(open_n, :first) {}
      repeat_walls, repeat_breakdowns = benchmark_open(open_n, :repeat) {}
      result[:first_open_ms] = summarize(first_walls)
      result[:first_open_samples] = first_walls.map(&:round)
      result[:repeat_open_ms] = summarize(repeat_walls)
      result[:repeat_open_samples] = repeat_walls.map(&:round)
      result[:open_pages] = (first_breakdowns + repeat_breakdowns).map { |b| b["pages"] }.uniq
      result[:open_dom_nodes] = (first_breakdowns + repeat_breakdowns).map { |b| b["domNodes"] }.uniq
      result[:open_math_errors] = (first_breakdowns + repeat_breakdowns).sum { |b| b["katexErrors"] }
      result[:open_error_text] = (first_breakdowns + repeat_breakdowns).any? { |b| b["errorText"] }
      result[:first_breakdown] = first_breakdowns.first
    end

    input_categories = %w[typing motion revelation suggestion]
    if only.nil? || only.include?("input") || input_categories.any? { |category| only.include?(category) }
      result[:inputs] = {}
      wants = ->(category) { only.nil? || only.include?("input") || only.include?(category) }
      result[:inputs][:typing] = benchmark_typing(name, source, smoke ? 4 : 20, stalls, overlaps) if wants.call("typing")
      result[:inputs][:motion] = benchmark_motion(name, source, smoke ? 4 : 20, stalls, overlaps) if wants.call("motion")
      result[:inputs][:revelation] = benchmark_revelation(name, source, smoke ? 2 : 10, stalls, overlaps) if wants.call("revelation")
      result[:inputs][:suggestion] = benchmark_suggestion(name, source, smoke ? 2 : 10, stalls, overlaps) if wants.call("suggestion")
    end
    result[:stalls_over_100ms] = stalls
    result[:stage_overlaps] = overlaps
    result
  end

  # Full settle (pages + fresh projection + editable + fonts + images),
  # not just the settled attribute: a late fonts.ready repagination pass
  # blocks the main thread for seconds and would swallow interactions.
  # quiet_ms additionally requires a longtask-free window so input samples
  # start from a stable baseline.
  QUIET_MS = 500
  def wait_for_full_settle(quiet_ms: 0)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + SETTLE_TIMEOUT
    loop do
      state = page.evaluate_script(SETTLE_SCRIPT)
      break if state && state["settled"] && state["fresh"] && state["editable"] &&
        state["fonts"] && state["imagesReady"] && state["quietMs"] >= quiet_ms

      now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      raise "visual pages never settled: #{state.inspect}" if now > deadline

      sleep 0.2
    end
  end

  # Fresh gate WITHOUT settled: focusing a block can legitimately unsettle
  # pagination (revelation mutates while focused, repagination defers), but
  # a blur installs any pending projection and restores freshness.
  def wait_for_fresh_quiet
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + SETTLE_TIMEOUT
    loop do
      state = page.evaluate_script(SETTLE_SCRIPT)
      break if state && state["fresh"] && state["editable"] &&
        state["fonts"] && state["imagesReady"] && state["quietMs"] >= QUIET_MS

      now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      raise "visual pages never fresh: #{state.inspect}" if now > deadline

      sleep 0.2
    end
  end

  # Quiet-only gate for per-sample use while focused: typing and revelation
  # keep the preview stale and pagination deferred BY DESIGN, so only the
  # longtask-free window is required.
  def wait_for_quiet
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + SETTLE_TIMEOUT
    loop do
      state = page.evaluate_script(SETTLE_SCRIPT)
      break if state && state["quietMs"] >= QUIET_MS

      now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      raise "visual pages never quiet: #{state.inspect}" if now > deadline

      sleep 0.2
    end
  end

  # Real click at a centered, header-clear point: Capybara's click
  # auto-scrolls tall elements under the sticky site header (click
  # intercepted), so scroll to center first, then drive viewport
  # coordinates with genuine mouse events (measurement stays honest).
  # The hit point and the resulting focus are verified; a covered
  # point (sticky header, overlays) scrolls clear and retries.
  def center_coords(selector, index, line_y = 420)
    # The projection surface scrolls inside its pane (the window barely
    # scrolls), so drive the pane until the target sits at a
    # header-clear viewport line. Converged across frames: skipped
    # content-visibility pages render asynchronously, so each measure
    # waits a beat before the next correction.
    4.times do
      done = page.evaluate_script(
        "(() => { const el = document.querySelectorAll('#{selector}')[#{index}];" \
        " const pane = el.closest('.editor-projection.preview-pane');" \
        " const r = el.getBoundingClientRect();" \
        " const dy = (r.top + Math.min(r.height, 48) / 2) - #{line_y};" \
        " if (Math.abs(dy) < 8) return true;" \
        " if (pane) pane.scrollTop += dy; else window.scrollBy(0, dy);" \
        " return false; })()"
      )
      break if done

      sleep 0.3
    end
    page.evaluate_script(
      "(() => { const el = document.querySelectorAll('#{selector}')[#{index}];" \
      " const r = el.getBoundingClientRect();" \
      " return [Math.round(r.left + Math.min(r.width, 240) / 2), Math.round(r.top + Math.min(r.height, 48) / 2)]; })()"
    )
  end

  # Focus + caret through the product's own caret bridge, retried
  # like Capybara waiting: post-settle preview churn briefly parks
  # blocks non-editable, and restoreCaret honestly refuses then. Setup
  # only: the measured keypress below is always genuine input.
  # Deterministic where element clicks flake (sticky headers,
  # transparent overlays, unrendered quiet pages).
  def bridge_caret_ready(block_index, which)
    # Scroll the target into view first: the bridge resolves the visible
    # fragment, and a real user scrolls before clicking. Setup scrolls
    # are unmeasured; only the keystroke after them is timed.
    page.evaluate_script(
      "(() => { const blocks = document.querySelectorAll('.document-surface [data-editor-block-id]');" \
      " const block = blocks[#{block_index}];" \
      " if (block) block.scrollIntoView({ block: 'center' }); return Boolean(block); })()"
    )
    sleep 0.4
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 15
    loop do
      caret = bridge_caret(block_index, which)
      return caret if caret == "caret:true"

      now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      raise "caret placement failed: #{caret}" if now > deadline

      sleep 0.3
    end
  end

  # The caret bridge can land element-anchored at block end (e.g. right
  # after trailing math, where no text node follows). The editor refuses
  # element-anchored input rather than corrupt source, so step left with
  # real ArrowLeft keys (unmeasured setup) until the caret sits in text.
  def ensure_text_caret(block_index)
    3.times do
      anchored = page.evaluate_script(
        "(() => { const sel = document.getSelection();" \
        " return sel.anchorNode ? sel.anchorNode.nodeType : 0; })()"
      )
      return true if anchored == 3

      page.driver.browser.action.send_keys(:arrow_left).perform
      sleep 0.2
    end
    page.evaluate_script(
      "document.getSelection().anchorNode ? document.getSelection().anchorNode.nodeType : 0"
    ) == 3
  end

  # The suggestion palette only triggers in plain prose (a "/" inside
  # inline code or math is literal text, correctly). Step left with real
  # ArrowLeft keys (unmeasured setup) until the text caret sits outside
  # code, math, and link spans.
  def ensure_plain_caret(block_index)
    12.times do
      return true if page.evaluate_script(
        "(() => { const sel = document.getSelection();" \
        " const node = sel.anchorNode;" \
        " if (!node || node.nodeType !== 3) return false;" \
        " const el = node.parentElement;" \
        " return el && !el.closest('code, pre, .katex, a'); })()"
      )

      page.driver.browser.action.send_keys(:arrow_left).perform
      sleep 0.2
    end
    false
  end

  def bridge_caret(block_index, which)
    page.evaluate_script(
      "(() => { const form = document.querySelector('form.visual-editor-form');" \
      " const adapter = form ? form.visualEditorController : null;" \
      " const block = document.querySelectorAll('.document-surface [data-editor-block-id]')[#{block_index}];" \
      " const id = block ? block.dataset.editorBlockId : null;" \
      " const map = adapter ? adapter.editor.map : null;" \
      " const regions = map ? (map.editable_regions || map.slides.flatMap((s) => s.editable_regions || [])) : [];" \
      " const region = regions.find((r) => r.block_id === id);" \
      " if (!adapter || !region) return 'no-region';" \
      " const at = #{which == :start ? "region.content_range.start" : "region.content_range.end"};" \
      " const result = adapter.restoreCaret(at, id);" \
      " if (result) return 'caret:true';" \
      " const editor = adapter.editor;" \
      " const frags = editor.blockFragments(id);" \
      " return 'caret:false|' + JSON.stringify({ frags: frags.length," \
      " ceAttr: block ? block.getAttribute('contenteditable') : 'missing'," \
      " stale: form.getAttribute('data-preview-projection-stale')," \
      " focusBlock: Boolean(editor.focusedProjectionBlock && editor.focusedProjectionBlock()) }); })()"
    )
  end

  def center_click(selector, index)
    # A transparent collapsed-source strip overlays one viewport band
    # (pre-existing); vary the target line so a covered point retries
    # elsewhere instead of converging on the same obstruction.
    [420, 580, 300].each do |line_y|
      coords = center_coords(selector, index, line_y)
      sleep 0.2
      hit = page.evaluate_script(
        "(() => { const target = document.querySelectorAll('#{selector}')[#{index}];" \
        " const el = document.elementFromPoint(#{coords[0]}, #{coords[1]});" \
        " return Boolean(el) && (target === el || target.contains(el)); })()"
      )
      next unless hit

      page.driver.browser.action.move_to_location(coords[0], coords[1]).click.perform
      sleep 0.2
      focused = page.evaluate_script(
        "(() => { const target = document.querySelectorAll('#{selector}')[#{index}];" \
        " const active = document.activeElement;" \
        " return Boolean(active) && (target === active || target.contains(active)); })()"
      )
      return if focused
    end
    raise "could not focus #{selector}[#{index}] after retries"
  end

  # Quiet offscreen pages skip rendering (content-visibility); after
  # scrolling one into view, wait until its content has boxes before
  # driving keys (setup only, never measured).
  def wait_for_rendered(selector, index)
    deadline = Process.clock_gettime(Process::CLOCK_MONOTONIC) + 10
    loop do
      rendered = page.evaluate_script(
        "(() => { const el = document.querySelectorAll('#{selector}')[#{index}];" \
        " if (!el) return false;" \
        " const kid = el.firstElementChild;" \
        " return Boolean(kid) && kid.getBoundingClientRect().height > 0; })()"
      )
      break if rendered

      now = Process.clock_gettime(Process::CLOCK_MONOTONIC)
      raise "block #{index} never rendered" if now > deadline

      center_coords(selector, index)
      sleep 0.3
    end
  end

  def benchmark_typing(name, source, count, stalls, overlaps)
    document = create_perf_document("Perf #{name} typing", source)
    visit edit_document_path(document)
    wait_for_full_settle
    # Two spread prose blocks (early + middle). Each keystroke commits and
    # marks the preview stale (reinstall deferred while focused); switching
    # blocks blurs, installing the pending projection and repaginating, so
    # settle after every switch and keep focus within a block's run.
    targets = page.evaluate_script(
      "(() => { const blocks = [...document.querySelectorAll('.document-surface [data-editor-block-id]')];" \
      " const seen = new Set(); const groups = [];" \
      " blocks.forEach((block, i) => { const id = block.dataset.editorBlockId;" \
      " const math = block.querySelector('.katex-display') !== null;" \
      " if (seen.has(id)) { const g = groups[groups.length - 1]; g.len += block.textContent.length; g.math = g.math || math; return; }" \
      " seen.add(id); groups.push({ i, len: block.textContent.length, math }); });" \
      " const prose = groups.filter((g) => g.len > 100 && !g.math).map((g) => g.i);" \
      " return [prose[0], prose[Math.floor(prose.length / 2)]]; })()"
    )
    raise "no prose blocks for typing benchmark" unless targets.is_a?(Array) && targets[0]
    targets = targets.uniq
    plan = ([targets[0]] * ((count + 1) / 2) + [targets[1] || targets[0]] * (count / 2))
    samples = []
    current = nil
    count.times do |index|
      target = plan[index]
      if target != current
        # Blur first: reinstalls defer while focused, so a focused
        # block would hold the preview stale (and the next block
        # non-editable) forever. A real click blurs the same way.
        page.evaluate_script("document.activeElement && document.activeElement.blur()")
        wait_for_fresh_quiet
        caret = bridge_caret_ready(target, :end)
        raise "typing caret placement failed: #{caret}" unless caret == "caret:true"
        raise "typing target #{target} has no text caret" unless ensure_text_caret(target)
        current = target
      end
      wait_for_quiet
      # Landing check reads the SOURCE (the real invariant: edits are
      # source transactions). Block DOM text is unreliable: page
      # fragments split one block across elements, so a char typed at
      # block end lands in a different element than the target index.
      source_before = page.evaluate_script(
        "document.querySelector('.source-field').editorController.value.length"
      )
      char = "aeiou"[index % 5]
      ms, flags, trace = measure_sample(KEY_PAINT_INSTALL) { page.driver.browser.action.send_keys(char).perform }
      source_after = page.evaluate_script(
        "document.querySelector('.source-field').editorController.value.length"
      )
      raise "typed char did not land in source (#{source_before} -> #{source_after}): #{trace}" unless source_after == source_before + 1
      record_input_sample(samples, stalls, overlaps, "typing", name, index, ms, flags, trace)
    end
    input_stats(samples)
  end

  def benchmark_motion(name, source, count, stalls, overlaps)
    document = create_perf_document("Perf #{name} motion", source)
    visit edit_document_path(document)
    wait_for_full_settle
    caret = bridge_caret_ready(0, :start)
    raise "motion caret placement failed: #{caret}" unless caret == "caret:true"
    page.evaluate_script("window.scrollTo(0, 0)")
    samples = []
    count.times do |index|
      wait_for_quiet
      ms, flags, trace = measure_sample(MOTION_PAINT_INSTALL) do
        page.driver.browser.action.send_keys(:arrow_down).perform
      end
      record_input_sample(samples, stalls, overlaps, "motion", name, index, ms, flags, trace)
    end
    input_stats(samples)
  end

  def benchmark_revelation(name, source, count, stalls, overlaps)
    document = create_perf_document("Perf #{name} reveal", source)
    visit edit_document_path(document)
    wait_for_full_settle
    total = page.evaluate_script("document.querySelectorAll('.document-surface .katex').length")
    samples = []
    count.times do |index|
      target = (index * 37) % total
      wait_for_quiet
      # Setup only: land the click point on the katex node itself
      # (transparent overlays cover some viewport bands), varying the
      # target line until the hit test passes. The measured click below
      # is genuine input.
      coords = nil
      [420, 580, 300].each do |line_y|
        candidate = center_coords(".document-surface .katex", target, line_y)
        hit = page.evaluate_script(
          "(() => { const target = document.querySelectorAll('.document-surface .katex')[#{target}];" \
          " const el = document.elementFromPoint(#{candidate[0]}, #{candidate[1]});" \
          " return Boolean(el) && (target === el || target.contains(el)); })()"
        )
        if hit
          coords = candidate
          break
        end
      end
      raise "katex #{target} never hittable" unless coords
      ms, flags, trace = measure_sample(REVEAL_PAINT_INSTALL) do
        page.driver.browser.action.move_to_location(coords[0], coords[1]).click.perform
      end
      record_input_sample(samples, stalls, overlaps, "revelation", name, index, ms, flags, trace)
      if ms == -1
        puts "PERF_TIMEOUT_STATE n=#{index} katex=#{target} " + page.evaluate_script(
          "(() => { const nodes = document.querySelectorAll('.document-surface .katex');" \
          " const node = nodes[#{target}];" \
          " const block = node ? node.closest('[data-editor-block-id]') : null;" \
          " const chain = []; let el = node ? node.parentElement : null;" \
          " while (el && chain.length < 4) { chain.push(el.tagName + '.' + String(el.className || '').slice(0, 20)); el = el.parentElement; }" \
          " return 'active=' + Boolean(document.querySelector('.editor-math-active'))" \
          " + ' display=' + Boolean(node && node.closest('.katex-display'))" \
          " + ' hasSource=' + Boolean(node && node.hasAttribute('data-editor-math-source'))" \
          " + ' chain=' + chain.join('>') + ' tex=' + JSON.stringify(node ? node.textContent.slice(0, 50) : null)" \
          " + ' blockCE=' + (block ? block.getAttribute('contenteditable') : null); })()"
        ).to_s
      end
      caret = bridge_caret_ready(0, :start)
      raise "revelation reset caret failed: #{caret}" unless caret == "caret:true"
    end
    input_stats(samples)
  end

  def benchmark_suggestion(name, source, count, stalls, overlaps)
    # Visual suggestion latency: the snippet palette is shared by both
    # modes, so triggers run in the visual editor (the default). One
    # trigger per spread prose block: trigger chars accumulate, and
    # switching blocks blurs (installing the pending projection and
    # repaginating), so settle after every switch like typing does.
    document = create_perf_document("Perf #{name} suggest", source)
    visit edit_document_path(document)
    wait_for_full_settle
    targets = page.evaluate_script(
      "(() => { const blocks = [...document.querySelectorAll('.document-surface [data-editor-block-id]')];" \
      " const seen = new Set(); const groups = [];" \
      " blocks.forEach((block, i) => { const id = block.dataset.editorBlockId;" \
      " const math = block.querySelector('.katex-display') !== null;" \
      " const code = block.querySelector('pre') !== null;" \
      " const table = block.querySelector('table') !== null;" \
      " if (seen.has(id)) { const g = groups[groups.length - 1]; g.len += block.textContent.length; g.math = g.math || math; g.code = g.code || code; g.table = g.table || table; return; }" \
      " seen.add(id); groups.push({ i, len: block.textContent.length, math, code, table }); });" \
      " const prose = groups.filter((g) => g.len > 100 && !g.math && !g.code && !g.table).map((g) => g.i);" \
      " return prose.filter((_, k) => k % Math.max(1, Math.floor(prose.length / #{count})) === 0).slice(0, #{count}); })()"
    )
    raise "no prose blocks for suggestion benchmark" unless targets.is_a?(Array) && targets.length == count
    samples = []
    count.times do |index|
      target = targets[index]
      # Blur first (reinstalls defer while focused), then focus + true
      # block end via the caret bridge. Element clicks flake against
      # settled 100-page projections; the measured trigger below is
      # genuine input.
      page.evaluate_script("document.activeElement && document.activeElement.blur()")
      wait_for_fresh_quiet
      caret = bridge_caret_ready(target, :end)
      raise "suggestion caret placement failed: #{caret}" unless caret == "caret:true"
      raise "suggestion target #{target} has no text caret" unless ensure_text_caret(target)
      raise "suggestion target #{target} has no plain caret" unless ensure_plain_caret(target)
      wait_for_quiet
      ms, flags, trace = measure_sample(SUGGEST_PAINT_INSTALL) do
        page.driver.browser.action.send_keys(" /i").perform
      end
      record_input_sample(samples, stalls, overlaps, "suggestion", name, index, ms, flags, trace)
      if ms == -1
        puts "PERF_TIMEOUT_STATE n=#{index} target=#{target} " + page.evaluate_script(
          "(() => { const pal = document.querySelector('.snippet-palette:not([hidden])');" \
          " const opts = pal ? pal.querySelectorAll('.snippet-option').length : 0;" \
          " const blocks = [...document.querySelectorAll('.document-surface [data-editor-block-id]')];" \
          " const block = blocks[#{target}];" \
          " const id = block ? block.dataset.editorBlockId : null;" \
          " const group = blocks.filter((b) => b.dataset.editorBlockId === id)" \
          " .map((b) => b.textContent).join('');" \
          " const sel = document.getSelection();" \
          " const anchor = sel.anchorNode;" \
          " const chain = [];" \
          " let el = anchor ? anchor.parentElement : null;" \
          " while (el && chain.length < 5) { chain.push(el.tagName + '.' + String(el.className || '').slice(0, 24)); el = el.parentElement; }" \
          " const prev = anchor && anchor.nodeType === 3 ? anchor.textContent.slice(Math.max(0, sel.anchorOffset - 24), sel.anchorOffset) : null;" \
          " return 'palette=' + Boolean(pal) + ' opts=' + opts" \
          " + ' landed=' + group.includes(' /i')" \
          " + ' blockTag=' + (block ? block.tagName : null)" \
          " + ' chain=' + chain.join('>') + ' prev=' + JSON.stringify(prev); })()"
        ).to_s
      end
      # Browser-level Escape: a projection reinstall between the trigger
      # and dismissal would stale any block handle.
      page.driver.browser.action.send_keys(:escape).perform
    end
    input_stats(samples)
  end

  # Timeouts (-1) are harness/app failures, not slow samples: exclude them
  # from stats, count them, and fail the run on any (see measure test).
  def input_stats(samples)
    valid = samples.reject { |s| s == -1 }
    { ms: summarize(valid), samples: samples.map { |s| s.round(1) }, timeouts: samples.count(-1) }
  end

  test "measure visual page benchmarks" do
    skip "measure mode only" if ENV["ELEF_PERF_MODE"] == "calibrate"

    report = {
      generated_at: Time.now.utc.iso8601,
      budgets: { open_p95_ms: 3000, input_p95_ms: 50, stall_ms: 100 },
      fixtures: {}
    }
    install_perf_probes
    report[:env] = env_info
    manifest = JSON.parse(File.read(File.join(FIXTURE_DIR, "manifest.json")))
    fixtures = {
      "mixed" => MIXED_FIXTURE,
      "math_heavy" => MATH_FIXTURE
    }
    # Freeze guards: the source bytes are pinned by the manifest, and
    # the rendered page count is a measured property of the current
    # renderer (recalibrated when rendering changes, never hand-tuned
    # to pass). Every open sample must reproduce the manifest exactly.
    fixtures.each do |name, path|
      expected_sha = manifest.dig("fixtures", name, "sha256")
      actual_sha = Digest::SHA256.hexdigest(File.read(path))
      assert_equal expected_sha, actual_sha, "#{name}: fixture source frozen"
    end
    fixtures.each do |name, path|
      report[:fixtures][name] = benchmark_fixture(name, File.read(path))
    end

    report_path = ENV["ELEF_PERF_REPORT"] || "/tmp/elef-perf-report-#{Time.now.utc.strftime("%Y%m%d-%H%M%S")}.json"
    File.write(report_path, JSON.pretty_generate(report))
    puts "PERF_REPORT #{report_path}"
    report[:fixtures].each do |name, result|
      puts "PERF_SUMMARY #{name} first_p95=#{result.dig(:first_open_ms, :p95_ms)} " \
        "repeat_p95=#{result.dig(:repeat_open_ms, :p95_ms)} " \
        "typing_p95=#{result.dig(:inputs, :typing, :ms, :p95_ms)} " \
        "motion_p95=#{result.dig(:inputs, :motion, :ms, :p95_ms)} " \
        "revelation_p95=#{result.dig(:inputs, :revelation, :ms, :p95_ms)} " \
        "suggestion_p95=#{result.dig(:inputs, :suggestion, :ms, :p95_ms)} " \
        "stalls=#{result[:stalls_over_100ms]&.length}"
    end

    report[:fixtures].each do |name, result|
      next unless result[:open_pages]

      expected_pages = manifest.dig("fixtures", name, "rendered_pages")
      assert_equal [expected_pages], result[:open_pages], "#{name}: every open sample must paginate to #{expected_pages} (manifest)"
      assert_equal 0, result[:open_math_errors], "#{name}: no math errors"
      refute result[:open_error_text], "#{name}: no <<ERROR>> text"
      stages = result.dig(:first_breakdown, "stages") || []
      assert stages.any? { |s| s["stage"] == "projection-install" }, "#{name}: install stage instrumented"
      assert stages.any? { |s| s["stage"] == "paginate" }, "#{name}: paginate stage instrumented"
    end

    report[:fixtures].each do |name, result|
      next unless result[:inputs]

      result[:inputs].each do |category, stats|
        assert_equal 0, stats[:timeouts], "#{name}/#{category}: no probe timeouts (#{stats[:samples].inspect})"
      end
    end
  end

  test "calibrate fixture page count under the reference layout" do
    skip "calibrate mode only" unless ENV["ELEF_PERF_MODE"] == "calibrate"

    source_path = ENV.fetch("ELEF_PERF_SOURCE")
    source = File.read(source_path)
    install_perf_probes
    document = create_perf_document("Perf calibration", source)
    wall, breakdown = measure_open(document, gate_images: false)
    puts "PERF_CALIBRATE #{JSON.generate({
      source: source_path,
      bytes: source.bytesize,
      attached: document.assets.blobs.map { |blob| blob.filename.to_s },
      wall_seconds: wall.round(3),
      breakdown: breakdown
    })}"
    assert breakdown["pages"] >= 1
  end
end
