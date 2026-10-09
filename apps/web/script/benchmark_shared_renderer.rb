require "json"

# Run with bin/rails runner -e test script/benchmark_shared_renderer.rb.
# Renderer timings only: these do not include disk reads, the worker bridge,
# DOM insertion, or supported-device application startup.
source = 100.times.map do |slide|
  "# Slide #{slide + 1}\n\nNotes with **emphasis** and $x^2$.\n\n```ruby\nputs #{slide}\n```\n"
end.join("\n---\n")

def measure
  started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
  yield
  (Process.clock_gettime(Process::CLOCK_MONOTONIC) - started) * 1_000
end

def p95(samples)
  samples.sort.fetch((samples.length * 0.95).ceil - 1).round(2)
end

cold = measure { Source::JavascriptRenderer.editor_preview(source, kind: :presentation, title: "100 slides") }
blocks = 20.times.map { measure { Source::JavascriptRenderer.render(source) } }
previews = 20.times.map { measure { Source::JavascriptRenderer.editor_preview(source, kind: :presentation, title: "100 slides") } }
puts JSON.pretty_generate(
  source_bytes: source.bytesize,
  slides: 100,
  runs: 20,
  ruby_version: RUBY_VERSION,
  platform: RUBY_PLATFORM,
  cold_preview_ms: cold.round(2),
  javascript_block_p95_ms: p95(blocks),
  javascript_projection_p95_ms: p95(previews)
)
