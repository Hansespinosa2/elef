# This file should ensure the existence of records required to run the application in every environment (production,
# development, test). The code here should be idempotent so that it can be executed at any point in every environment.
# The data can then be loaded with the bin/rails db:seed command (or created alongside the database with db:setup).
#
# Example:
#
#   ["Action", "Comedy", "Drama", "Horror"].each do |genre_name|
#     MovieGenre.find_or_create_by!(name: genre_name)
#   end

Presentations::SampleData.load!
Presentations::LineageSampleData.load!
Documents::SampleData.load!

[
  { name: "Bold text", trigger: "bold", description: "Emphasized Markdown text", category: "Markdown", body: "**${1:text}**" },
  { name: "Bullet list", trigger: "list", description: "A short Markdown list", category: "Markdown", body: "- ${1:first item}\n- ${2:second item}" },
  { name: "Display equation", trigger: "beq", description: "A block LaTeX equation", category: "LaTeX", body: "$$\n${1:equation}\n$$" },
  { name: "Inline equation", trigger: "ieq", description: "An inline LaTeX equation", category: "LaTeX", body: "$\n${1:equation}\n$" },
  { name: "Position directive", trigger: "pos", description: "Position one to three tokens", category: "Elef DSL", body: ":::position{${1}}" },
  { name: "Section directive", trigger: "sse", description: "Create a section", category: "Elef DSL", body: ":::section{${1:section name}}" },
  { name: "Subsection directive", trigger: "sss", description: "Create a subsection", category: "Elef DSL", body: ":::subsection{${1:subsection name}}" },
  { name: "Footnote directive", trigger: "foot", description: "Add a footnote", category: "Elef DSL", body: ":::footnote{${1:footnote text}}" }
].each do |attributes|
  snippet = Snippet.find_or_initialize_by(trigger: attributes[:trigger], name: attributes[:name], built_in: true)
  snippet.assign_attributes(attributes)
  snippet.save!
end
