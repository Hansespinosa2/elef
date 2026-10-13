#!/usr/bin/env ruby
# frozen_string_literal: true

require "json"
require "pathname"

# Canonical PPTX-model baselines shared by the web (Ruby) and desktop (TS)
# parity tests. The server is the source of truth: regenerate the committed
# *.expected.json files after an INTENTIONAL model-shape change with (from
# apps/web):
#   PGHOST=127.0.0.1 PGUSER=postgres PGPASSWORD=postgres PGTESTDATABASE=elef_test \
#     RAILS_ENV=test REGENERATE_EXPORT_PARITY=1 bin/rails runner ../../tooling/export_parity_baselines.rb
# Never regenerate to match a surprising diff: a mismatch means the desktop
# port drifted from the server, and the fix belongs in the port
# (packages/client/src/features/export/pptx_model.ts), not the baselines.
module ExportParityBaselines
  # Fixtures whose canonical models must be byte-identical on both hosts.
  # Media fixtures (local-image, remote-image) are structural-only: the
  # server inlines media bytes/paths while the desktop keeps resolvable
  # URLs, so each side asserts its own contract on the shared source.
  FIXTURE_IDS = %w[defaults headings rich].freeze

  def self.parity_dir
    Pathname.new(__dir__).join("../packages/client/test/fixtures/export-parity")
  end

  def self.canonical(value)
    case value
    when Hash then value.map { |key, entry| [key.to_s, canonical(entry)] }.sort_by(&:first).to_h
    when Array then value.map { |entry| canonical(entry) }
    else value
    end
  end

  def self.regenerate!
    FIXTURE_IDS.each do |id|
      fixture = JSON.parse(File.read(parity_dir.join("#{id}.fixture.json")))
      presentation = Presentation.new(title: fixture.fetch("title"), source: fixture.fetch("source"))
      payload = Presentations::PptxExport.new(presentation).as_json
      File.binwrite(parity_dir.join("#{id}.expected.json"), JSON.generate(canonical(payload)))
    end
  end
end

ExportParityBaselines.regenerate! if ENV["REGENERATE_EXPORT_PARITY"]
