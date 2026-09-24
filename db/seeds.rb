# This file should ensure the existence of records required to run the application in every environment (production,
# development, test). The code here should be idempotent so that it can be executed at any point in every environment.
# The data can then be loaded with the bin/rails db:seed command (or created alongside the database with db:setup).
#
# Example:
#
#   ["Action", "Comedy", "Drama", "Horror"].each do |genre_name|
#     MovieGenre.find_or_create_by!(name: genre_name)
#   end

Workspace.default

Presentations::SampleData.load!
Presentations::LineageSampleData.load!
document_sample_result = Documents::SampleData.load!
if document_sample_result.conflicts.any?
  titles = document_sample_result.conflicts.map { |conflict| %("#{conflict.title}") }.to_sentence
  warn "Skipped sample documents with conflicting titles: #{titles}."
end

Snippets::Catalog::DEFAULTS.each do |attributes|
  snippet = Snippet.find_or_initialize_by(trigger: attributes[:trigger], name: attributes[:name], built_in: true)
  snippet.assign_attributes(attributes.except(:id))
  snippet.save!
end

MathShortcuts::Catalog::DEFAULTS.each do |attributes|
  shortcut = MathShortcut.find_or_initialize_by(
    workspace: Workspace.default,
    name: attributes[:name],
    prefix: attributes[:prefix],
    built_in: true
  )
  shortcut.assign_attributes(attributes.except(:id))
  shortcut.save!
end
