# Shared editor-facing registry for source authoring commands.
module AuthoringRegistry
  module_function

  def for_editor(workspace: Workspace.default)
    snippet_entries = Snippets::Catalog.for_editor.map do |snippet|
      namespace = snippet[:category] == "Elef DSL" ? ":" : "/"
      placeholders = snippet[:body].to_s.scan(/\$\{(\d+)(?::([^}]*))?\}/).map do |number, label|
        { position: number.to_i, label: label.to_s }
      end
      {
        **snippet,
        namespace: namespace,
        aliases: [],
        search_terms: [snippet[:trigger], snippet[:name], snippet[:description]].compact,
        contexts: ["source"],
        behavior: { type: "insert", template: snippet[:body], placeholders: placeholders },
        commit_behavior: "accept_palette_selection",
        documentation_example: "#{namespace}#{snippet[:trigger]} → #{snippet[:body]}",
        argument_schema: snippet[:trigger] == "align" ? { grammar: ["horizontal", "vertical"], values: [["left", "center", "right", "top", "middle", "bottom"], ["top", "middle", "bottom"]] } : nil
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
    when "Bold", "Blackboard bold" then "style"
    when "Vector" then "decoration"
    when "Transpose", "Inverse" then "mathematical_postfix"
    else nil
    end
  end
  private_class_method :operator_class
end
