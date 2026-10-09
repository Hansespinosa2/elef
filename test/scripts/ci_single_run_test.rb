#!/usr/bin/env ruby

require "yaml"

workflow_path = File.expand_path("../../.github/workflows/ci.yml", __dir__)
workflow = YAML.load_file(workflow_path, aliases: true)
events = workflow["on"] || workflow[true]
jobs = workflow.fetch("jobs")

required_checks = %w[
  desktop-fast
  scan_ruby
  scan_js
  test
  sqlite-test
  system-test
  desktop
  desktop-macos
  renderer-macos
  production-smoke
  development-smoke
]

branch_push_checks = %w[desktop-fast desktop desktop-macos renderer-macos]
(required_checks - branch_push_checks).each do |job_name|
  job = jobs.fetch(job_name)
  abort "#{job_name} must run for pull requests and dispatch, but not branch pushes" unless
    job["if"] == "github.event_name != 'push'"
end

branch_push_checks.each do |job_name|
  abort "#{job_name} must also run on dev and main pushes" if jobs.fetch(job_name).key?("if")
end

abort "CI must run for pull requests" unless events.key?("pull_request")
abort "CI must retain manual validation" unless events.key?("workflow_dispatch")

attestation = jobs.fetch("record-ci-attestation")
abort "the attestation must depend on every required check" unless
  attestation.fetch("needs").sort == required_checks.sort
abort "the attestation must only be recorded for pull requests" unless
  attestation["if"] == "github.event_name == 'pull_request'"

publisher = jobs.fetch("publish-deployment-ref")
abort "deployment publishing must be a lightweight post-merge push job" unless
  publisher["if"] == "github.event_name == 'push' && (github.ref_name == 'dev' || github.ref_name == 'main')" &&
    !publisher.key?("needs")
abort "deployment authorization requires only scoped read access plus ref-write access" unless
  publisher.fetch("permissions") == {
    "contents" => "write",
    "actions" => "read",
    "checks" => "read",
    "pull-requests" => "read"
  }

run_steps = jobs.flat_map do |job_name, job|
  job.fetch("steps", []).filter_map do |step|
    [job_name, step["run"]] if step["run"]
  end
end

{
  "npm run test:javascript" => "desktop-fast",
  "npm test --prefix desktop/frontend" => "desktop-fast",
  "npm run test:unit --prefix desktop/e2e" => "desktop-fast",
  "cargo test --manifest-path desktop/Cargo.toml -p elef-core --locked" => "desktop-fast"
}.each do |command, expected_job|
  matches = run_steps.select { |_job_name, run| run.include?(command) }
  abort "#{command} must run exactly once in #{expected_job}, found #{matches.map(&:first)}" unless
    matches.map(&:first) == [expected_job]
end

abort "the explicit JavaScript file block must stay removed" if
  workflow.to_s.include?("node test/javascript/")

runner_source = File.read(File.expand_path("../../desktop/e2e/run.mjs", __dir__))
abort "the runner must keep one sequential shared-web phase" unless
  runner_source.scan('["test", "--project=web"]').length == 1 &&
    runner_source.include?('env.ELEF_E2E_SKIP_WEB !== "1"')
mac_desktop_run = jobs.fetch("desktop-macos").fetch("steps").find do |step|
  step.fetch("name", "").include?("macOS native and updater scenarios")
end
abort "macOS must run the shared scenario adapter without repeating Chromium web scenarios" unless
  mac_desktop_run&.dig("env", "ELEF_E2E_SKIP_WEB") == "1"

sqlite_run = jobs.fetch("sqlite-test").fetch("steps").find { |step| step["name"] == "Run SQLite compatibility tests" }
abort "PR SQLite must run only the documented differential matrix" unless
  sqlite_run.fetch("run", "").include?("bin/rails test test/sqlite_compatibility_test.rb") &&
    !sqlite_run.fetch("run", "").include?("db:test:prepare test")

sqlite_workflow = YAML.load_file(File.expand_path("../../.github/workflows/sqlite-compatibility.yml", __dir__))
sqlite_events = sqlite_workflow["on"] || sqlite_workflow[true]
full_sqlite_commands = sqlite_workflow.fetch("jobs").values.flat_map { |job| job.fetch("steps", []) }.filter_map { |step| step["run"] }
abort "the full SQLite suite must run on dev pushes, on a schedule, and manually" unless
  sqlite_events.dig("push", "branches") == ["dev"] && sqlite_events.key?("schedule") &&
    sqlite_events.key?("workflow_dispatch") &&
    full_sqlite_commands.any? { |run| run.include?("bin/rails db:test:prepare test") }

performance_workflow = YAML.load_file(File.expand_path("../../.github/workflows/native-performance.yml", __dir__))
performance_events = performance_workflow["on"] || performance_workflow[true]
abort "native performance must remain outside PR authorization" unless
  performance_events.dig("push", "branches") == ["dev"] && performance_events.key?("schedule") &&
    performance_events.key?("workflow_dispatch") && !performance_events.key?("pull_request") &&
    performance_workflow.fetch("jobs").values.flat_map { |job| job.fetch("steps", []) }.any? do |step|
      step.fetch("run", "").include?("--launch-count 10 --report-runner")
    end
abort "native benchmark must not run in a required CI job" if workflow.to_s.include?("benchmark-native.mjs")

attestation_step = attestation.fetch("steps").find { |step| step["name"] == "Record the tested source tree" }
attestation_run = attestation_step.fetch("run", "")
abort "the attestation must name the required CI jobs and non-gating measurement policy" unless
  attestation_run.include?("schema_version: $schema_version") &&
    attestation_run.include?("required_jobs: $required_jobs") &&
    attestation_run.include?("non_gating_measurements: $non_gating_measurements") &&
    attestation_run.include?('["native-performance"]')
verifier = File.read(File.expand_path("../../scripts/verify-deployment-authorization", __dir__))
abort "the verifier must validate the benchmark policy and required-job manifest" unless
  verifier.include?(".schema_version == 2") &&
    verifier.include?(".required_jobs == $required_jobs") &&
    verifier.include?('.non_gating_measurements == ["native-performance"]')

puts "CI keeps all required checks, runs pure unit suites once, and verifies the attested tree before publishing"
