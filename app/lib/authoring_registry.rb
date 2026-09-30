# Shared editor-facing registry for source authoring commands.
module AuthoringRegistry
  module_function

  LEGACY_DIRECTIVE_TRIGGERS = {
    "sse" => "section",
    "sss" => "subsection",
    "foot" => "footnote"
  }.freeze

  DIRECTIVE_SCHEMAS = {
    "align" => { grammar: ["alignment_or_position", "vertical_position?"], argument_count: { minimum: 1, maximum: 2 }, values: [["left", "center", "right", "top", "middle", "bottom"], ["top", "middle", "bottom"]] },
    "section" => { grammar: ["text"], argument_count: 1, values: [] },
    "subsection" => { grammar: ["text"], argument_count: 1, values: [] },
    "footnote" => { grammar: ["text"], argument_count: 1, values: [] }
  }.freeze

  def for_editor(workspace: Workspace.default)
    snippet_entries = Snippets::Catalog.for_editor.map do |snippet|
      namespace = snippet[:category] == "Elef DSL" ? ":" : "/"
      canonical_trigger = LEGACY_DIRECTIVE_TRIGGERS.fetch(snippet[:trigger], snippet[:trigger])
      aliases = canonical_trigger == snippet[:trigger] ? [] : [snippet[:trigger]]
      placeholders = snippet[:body].to_s.scan(/\$\{(\d+)(?::([^}]*))?\}/).map do |number, label|
        { position: number.to_i, label: label.to_s }
      end
      {
        **snippet,
        namespace: namespace,
        trigger: canonical_trigger,
        aliases: aliases,
        search_terms: [canonical_trigger, *aliases, snippet[:name], snippet[:description]].compact,
        contexts: snippet[:category] == "LaTeX" && !snippet[:body].to_s.match?(/\A\s*\$/) ? ["math"] : ["source"],
        behavior: { type: snippet[:id] == "default-diagram" ? "mermaid_assist" : "insert", template: snippet[:body], placeholders: placeholders },
        commit_behavior: "accept_palette_selection",
        documentation_example: "#{namespace}#{canonical_trigger} → #{snippet[:body]}",
        argument_schema: namespace == ":" ? DIRECTIVE_SCHEMAS.fetch(canonical_trigger, { grammar: ["free_text"] }) : nil
      }
    end

    math_entries = MathShortcuts::Catalog.for_editor(workspace: workspace).map do |shortcut|
      behavior = shortcut[:prefix] == "." ? "transform" : "insert"
      placeholders = shortcut[:expansion].to_s.scan(/\$\{(\d+)(?::([^}]*))?\}/).map do |number, label|
        { position: number.to_i, label: label.to_s }
      end
      {
        **shortcut,
        namespace: shortcut[:prefix],
        trigger: shortcut[:aliases].first,
        search_terms: [shortcut[:name], *shortcut[:aliases], shortcut[:description]].compact,
        contexts: ["math"],
        commit_behavior: behavior == "transform" ? ["space", "tab", "enter", "cursor_leaves_chain", "editor_blur", "save"] : "accept_palette_selection",
        documentation_example: "#{shortcut[:prefix]}#{shortcut[:aliases].first} → #{shortcut[:expansion]}",
        behavior: {
          type: behavior,
          template: shortcut[:expansion],
          placeholders: placeholders,
          operator_class: operator_class(shortcut[:name]),
          accepted_operand: behavior == "transform" ? "atomic_math_object" : nil,
          serializer: shortcut[:expansion]
        }
      }
    end

    [*snippet_entries, *math_entries]
  end

  def operator_class(name)
    case name
    when "Bold", "Blackboard bold", "Calligraphic", "Roman" then "style"
    when "Vector", "Bar", "Hat", "Tilde" then "decoration"
    when "Transpose", "Inverse" then "mathematical_postfix"
    else nil
    end
  end
  private_class_method :operator_class
end
