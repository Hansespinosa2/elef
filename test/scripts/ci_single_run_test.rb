#!/usr/bin/env ruby

require "yaml"

workflow_path = File.expand_path("../../.github/workflows/ci.yml", __dir__)
workflow = YAML.load_file(workflow_path, aliases: true)
events = workflow["on"] || workflow[true]
jobs = workflow.fetch("jobs")

required_checks = %w[
  scan_ruby
  scan_js
  test
  sqlite-test
  system-test
  desktop
  desktop-macos
  production-smoke
  development-smoke
]

branch_push_checks = %w[desktop desktop-macos]
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

puts "CI runs the nine required checks once per PR and verifies them before publishing"
