#!/usr/bin/env ruby
# frozen_string_literal: true

module PullRequestDescription
  REQUIRED_SECTIONS = [
    "## Summary",
    "## Why",
    "## What changed",
    "## Screenshots",
    "## Validation",
    "## Adversarial reviews",
    "## Parity",
    "## Gaps",
    "## Database / migration impact"
  ].freeze

  def self.errors(body)
    text = body.to_s
    errors = []

    REQUIRED_SECTIONS.each do |section|
      errors << "missing required section: #{section}" unless text.match?(/^#{Regexp.escape(section)}\s*$/i)
    end

    if text.match?(/\bnot\s+merged\b/i)
      errors << "do not record current merge status in the description; GitHub is the source of truth"
    end

    REQUIRED_SECTIONS.each do |section|
      section_body = text[/^#{Regexp.escape(section)}\s*$\n?(.*?)(?=^##\s|\z)/im, 1].to_s
      section_body = section_body.gsub(/<!--.*?-->/m, "").strip
      errors << "section is empty: #{section}" if section_body.empty?
    end

    errors
  end
end

if $PROGRAM_NAME == __FILE__
  errors = PullRequestDescription.errors(ENV.fetch("PR_BODY", ""))
  if errors.empty?
    puts "PR description checks passed"
  else
    warn errors.map { |error| "- #{error}" }
    exit 1
  end
end
