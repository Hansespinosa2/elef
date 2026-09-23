module MathShortcuts
  class Catalog
    PLACEHOLDER = /\$\{(\d+)(?::([^}]*))?\}/.freeze
    DEFAULTS = [
      { id: "default-bold", name: "Bold", aliases: %w[b bold], prefix: ".", description: "Bold mathematical symbols", expansion: "\\mathbf{${1}}", built_in: true },
      { id: "default-hat", name: "Hat", aliases: %w[h hat], prefix: ".", description: "Put a hat over a symbol", expansion: "\\hat{${1}}", built_in: true },
      { id: "default-tilde", name: "Tilde", aliases: %w[t tilde], prefix: ".", description: "Put a tilde over a symbol", expansion: "\\tilde{${1}}", built_in: true },
      { id: "default-transpose", name: "Transpose", aliases: %w[T tr transpose], prefix: ".", description: "Add a mathematical transpose", expansion: "${1}^{\\mathsf{T}}", built_in: true },
      { id: "default-vector", name: "Vector", aliases: %w[v vec vector], prefix: ".", description: "Put a vector arrow over a symbol", expansion: "\\vec{${1}}", built_in: true },
      { id: "default-dot", name: "Dot", aliases: %w[dot], prefix: ".", description: "Put a dot over a symbol", expansion: "\\dot{${1}}", built_in: true },
      { id: "default-bar", name: "Bar", aliases: %w[bar], prefix: ".", description: "Put a bar over a symbol", expansion: "\\bar{${1}}", built_in: true },
      { id: "default-alpha", name: "Alpha", aliases: %w[a alpha], prefix: "@", description: "Greek alpha", expansion: "\\alpha", built_in: true },
      { id: "default-beta", name: "Beta", aliases: %w[beta], prefix: "@", description: "Greek beta", expansion: "\\beta", built_in: true },
      { id: "default-gamma", name: "Gamma", aliases: %w[g gamma], prefix: "@", description: "Greek gamma", expansion: "\\gamma", built_in: true },
      { id: "default-delta", name: "Delta", aliases: %w[d delta], prefix: "@", description: "Greek delta", expansion: "\\delta", built_in: true },
      { id: "default-theta", name: "Theta", aliases: %w[th theta], prefix: "@", description: "Greek theta", expansion: "\\theta", built_in: true },
      { id: "default-lambda", name: "Lambda", aliases: %w[l lambda], prefix: "@", description: "Greek lambda", expansion: "\\lambda", built_in: true },
      { id: "default-pi", name: "Pi", aliases: %w[p pi], prefix: "@", description: "Greek pi", expansion: "\\pi", built_in: true },
      { id: "default-sigma", name: "Sigma", aliases: %w[s sigma], prefix: "@", description: "Greek sigma", expansion: "\\sigma", built_in: true },
      { id: "default-phi", name: "Phi", aliases: %w[ph phi], prefix: "@", description: "Greek phi", expansion: "\\phi", built_in: true },
      { id: "default-omega", name: "Omega", aliases: %w[o omega], prefix: "@", description: "Greek omega", expansion: "\\omega", built_in: true }
    ].freeze

    def self.all(workspace: Workspace.default)
      MathShortcut.where(workspace: workspace).ordered
    end

    def self.for_editor(workspace: Workspace.default)
      persisted = all(workspace: workspace).map do |shortcut|
        {
          id: shortcut.id,
          name: shortcut.name,
          aliases: shortcut.aliases,
          description: shortcut.description,
          prefix: shortcut.prefix,
          expansion: shortcut.expansion,
          built_in: shortcut.built_in
        }
      end
      persisted_aliases = persisted.flat_map { |shortcut| shortcut[:aliases] }
      defaults = DEFAULTS.reject { |shortcut| (shortcut[:aliases] & persisted_aliases).any? }
      defaults + persisted
    end

    def self.for_ui(workspace: Workspace.default)
      persisted = all(workspace: workspace).index_by { |shortcut| shortcut.id.to_s }
      for_editor(workspace: workspace).map do |attributes|
        persisted[attributes[:id].to_s] || MathShortcut.new(
          name: attributes[:name],
          aliases: attributes[:aliases],
          description: attributes[:description],
          prefix: attributes[:prefix],
          expansion: attributes[:expansion],
          built_in: attributes[:built_in],
          workspace: workspace
        )
      end
    end

    def self.expand(expansion, value: nil)
      stops = []
      text = expansion.to_s.gsub(PLACEHOLDER) do
        match = Regexp.last_match
        replacement = match[2].to_s
        replacement = value.to_s if match[1].to_i == 1 && value
        stops << { number: match[1].to_i, start: Regexp.last_match.begin(0), length: replacement.length }
        replacement
      end
      { text: text, stops: stops.sort_by { |stop| stop[:number].zero? ? Float::INFINITY : stop[:number] } }
    end
  end
end
