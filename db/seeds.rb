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

math_shortcuts = [
  { name: "Bold", aliases: %w[b bold], prefix: ".", description: "Bold mathematical symbols", expansion: "\\mathbf{${1}}" },
  { name: "Hat", aliases: %w[h hat], prefix: ".", description: "Put a hat over a symbol", expansion: "\\hat{${1}}" },
  { name: "Tilde", aliases: %w[t tilde], prefix: ".", description: "Put a tilde over a symbol", expansion: "\\tilde{${1}}" },
  { name: "Transpose", aliases: %w[T tr transpose], prefix: ".", description: "Add a mathematical transpose", expansion: "${1}^{\\mathsf{T}}" },
  { name: "Vector", aliases: %w[v vec vector], prefix: ".", description: "Put a vector arrow over a symbol", expansion: "\\vec{${1}}" },
  { name: "Dot", aliases: %w[dot], prefix: ".", description: "Put a dot over a symbol", expansion: "\\dot{${1}}" },
  { name: "Bar", aliases: %w[bar], prefix: ".", description: "Put a bar over a symbol", expansion: "\\bar{${1}}" },
  { name: "Underline", aliases: %w[u underline], prefix: ".", description: "Underline a symbol", expansion: "\\underline{${1}}" },
  { name: "Alpha", aliases: %w[a alpha], prefix: "@", description: "Greek alpha", expansion: "\\alpha" },
  { name: "Beta", aliases: %w[beta], prefix: "@", description: "Greek beta", expansion: "\\beta" },
  { name: "Gamma", aliases: %w[g gamma], prefix: "@", description: "Greek gamma", expansion: "\\gamma" },
  { name: "Delta", aliases: %w[d delta], prefix: "@", description: "Greek delta", expansion: "\\delta" },
  { name: "Epsilon", aliases: %w[e epsilon], prefix: "@", description: "Greek epsilon", expansion: "\\epsilon" },
  { name: "Theta", aliases: %w[th theta], prefix: "@", description: "Greek theta", expansion: "\\theta" },
  { name: "Lambda", aliases: %w[l lambda], prefix: "@", description: "Greek lambda", expansion: "\\lambda" },
  { name: "Mu", aliases: %w[mu], prefix: "@", description: "Greek mu", expansion: "\\mu" },
  { name: "Pi", aliases: %w[p pi], prefix: "@", description: "Greek pi", expansion: "\\pi" },
  { name: "Sigma", aliases: %w[s sigma], prefix: "@", description: "Greek sigma", expansion: "\\sigma" },
  { name: "Phi", aliases: %w[ph phi], prefix: "@", description: "Greek phi", expansion: "\\phi" },
  { name: "Omega", aliases: %w[o omega], prefix: "@", description: "Greek omega", expansion: "\\omega" }
].each do |attributes|
  shortcut = MathShortcut.find_or_initialize_by(
    workspace: Workspace.default,
    name: attributes[:name],
    prefix: attributes[:prefix],
    built_in: true
  )
  shortcut.assign_attributes(attributes)
  shortcut.save!
end
