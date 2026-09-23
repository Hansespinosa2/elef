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
      { id: "default-underline", name: "Underline", aliases: %w[u underline], prefix: ".", description: "Underline a symbol", expansion: "\\underline{${1}}", built_in: true },
      { id: "default-alpha", name: "Alpha", aliases: %w[a alpha], prefix: "@", description: "Greek alpha", expansion: "\\alpha", built_in: true },
      { id: "default-beta", name: "Beta", aliases: %w[beta], prefix: "@", description: "Greek beta", expansion: "\\beta", built_in: true },
      { id: "default-gamma", name: "Gamma", aliases: %w[g gamma], prefix: "@", description: "Greek gamma", expansion: "\\gamma", built_in: true },
      { id: "default-delta", name: "Delta", aliases: %w[d delta], prefix: "@", description: "Greek delta", expansion: "\\delta", built_in: true },
      { id: "default-theta", name: "Theta", aliases: %w[th theta], prefix: "@", description: "Greek theta", expansion: "\\theta", built_in: true },
      { id: "default-lambda", name: "Lambda", aliases: %w[l lambda], prefix: "@", description: "Greek lambda", expansion: "\\lambda", built_in: true },
      { id: "default-pi", name: "Pi", aliases: %w[p pi], prefix: "@", description: "Greek pi", expansion: "\\pi", built_in: true },
      { id: "default-sigma", name: "Sigma", aliases: %w[s sigma], prefix: "@", description: "Greek sigma", expansion: "\\sigma", built_in: true },
      { id: "default-phi", name: "Phi", aliases: %w[ph phi], prefix: "@", description: "Greek phi", expansion: "\\phi", built_in: true },
      { id: "default-omega", name: "Omega", aliases: %w[o omega], prefix: "@", description: "Greek omega", expansion: "\\omega", built_in: true },
      { id: "default-nabla", name: "Nabla", aliases: %w[nabla grad del], prefix: "@", description: "Gradient or del operator", expansion: "\\nabla", built_in: true },
      { id: "default-to", name: "Right arrow", aliases: %w[to rightarrow], prefix: "@", description: "Right-pointing relation", expansion: "\\to", built_in: true },
      { id: "default-implies", name: "Implies", aliases: %w[implies longrightarrow], prefix: "@", description: "Logical implication arrow", expansion: "\\implies", built_in: true },
      { id: "default-iff", name: "If and only if", aliases: %w[iff longleftrightarrow], prefix: "@", description: "Logical equivalence arrow", expansion: "\\iff", built_in: true },
      { id: "default-inf", name: "Infimum", aliases: %w[inf infimum], prefix: "@", description: "Infimum operator", expansion: "\\inf", built_in: true },
      { id: "default-sup", name: "Supremum", aliases: %w[sup supremum], prefix: "@", description: "Supremum operator", expansion: "\\sup", built_in: true },
      { id: "default-lim", name: "Limit", aliases: %w[lim limit], prefix: "@", description: "Limit operator", expansion: "\\lim", built_in: true },
      { id: "default-sum", name: "Summation", aliases: %w[sum summation], prefix: "@", description: "Summation operator", expansion: "\\sum", built_in: true },
      { id: "default-prod", name: "Product", aliases: %w[prod product], prefix: "@", description: "Product operator", expansion: "\\prod", built_in: true },
      { id: "default-int", name: "Integral", aliases: %w[int integral], prefix: "@", description: "Integral operator", expansion: "\\int", built_in: true },
      { id: "default-partial", name: "Partial", aliases: %w[partial], prefix: "@", description: "Partial derivative symbol", expansion: "\\partial", built_in: true },
      { id: "default-infty", name: "Infinity", aliases: %w[infty infinity], prefix: "@", description: "Infinity symbol", expansion: "\\infty", built_in: true },
      { id: "default-forall", name: "For all", aliases: %w[forall], prefix: "@", description: "Universal quantifier", expansion: "\\forall", built_in: true },
      { id: "default-exists", name: "There exists", aliases: %w[exists], prefix: "@", description: "Existential quantifier", expansion: "\\exists", built_in: true },
      { id: "default-in", name: "Element of", aliases: %w[in element], prefix: "@", description: "Set membership relation", expansion: "\\in", built_in: true },
      { id: "default-notin", name: "Not an element of", aliases: %w[notin], prefix: "@", description: "Set non-membership relation", expansion: "\\notin", built_in: true },
      { id: "default-leq", name: "Less than or equal", aliases: %w[leq le], prefix: "@", description: "Less-than-or-equal relation", expansion: "\\leq", built_in: true },
      { id: "default-geq", name: "Greater than or equal", aliases: %w[geq ge], prefix: "@", description: "Greater-than-or-equal relation", expansion: "\\geq", built_in: true },
      { id: "default-neq", name: "Not equal", aliases: %w[neq], prefix: "@", description: "Not-equal relation", expansion: "\\neq", built_in: true },
      { id: "default-approx", name: "Approximately", aliases: %w[approx], prefix: "@", description: "Approximation relation", expansion: "\\approx", built_in: true },
      { id: "default-times", name: "Times", aliases: %w[times], prefix: "@", description: "Multiplication symbol", expansion: "\\times", built_in: true },
      { id: "default-cdot", name: "Dot product", aliases: %w[cdot dotproduct], prefix: "@", description: "Centered multiplication dot", expansion: "\\cdot", built_in: true },
      { id: "default-frac", name: "Fraction", aliases: %w[frac fraction], prefix: "@", description: "Fraction with numerator and denominator", expansion: "\\frac{${1}}{${2}}", built_in: true },
      { id: "default-sqrt", name: "Square root", aliases: %w[sqrt root], prefix: "@", description: "Square root with one slot", expansion: "\\sqrt{${1}}", built_in: true }
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
      source = expansion.to_s
      text = +""
      cursor = 0

      source.to_enum(:scan, PLACEHOLDER).each do
        match = Regexp.last_match
        text << source[cursor...match.begin(0)]
        replacement = match[2].to_s
        replacement = value.to_s if match[1].to_i == 1 && !value.nil?
        stops << { number: match[1].to_i, start: text.length, length: replacement.length }
        text << replacement
        cursor = match.end(0)
      end

      text << source[cursor..] if cursor < source.length
      { text: text, stops: stops.sort_by { |stop| stop[:number].zero? ? Float::INFINITY : stop[:number] } }
    end
  end
end
