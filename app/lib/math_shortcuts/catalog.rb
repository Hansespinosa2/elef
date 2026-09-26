module MathShortcuts
  class Catalog
    PLACEHOLDER = /\$\{(\d+)(?::([^}]*))?\}/.freeze
    DEFAULTS = [
      { id: "default-bold", name: "Bold", aliases: %w[b bb bold], prefix: ".", description: "Bold mathematical symbols", expansion: "\\mathbf{${1}}", built_in: true },
      { id: "default-hat", name: "Hat", aliases: %w[h hat], prefix: ".", description: "Put a hat over a symbol", expansion: "\\hat{${1}}", built_in: true },
      { id: "default-tilde", name: "Tilde", aliases: %w[t tilde], prefix: ".", description: "Put a tilde over a symbol", expansion: "\\tilde{${1}}", built_in: true },
      { id: "default-transpose", name: "Transpose", aliases: %w[T tr transpose], prefix: ".", description: "Add a mathematical transpose", expansion: "${1}^{\\mathsf{T}}", built_in: true },
      { id: "default-vector", name: "Vector", aliases: %w[v vec vector], prefix: ".", description: "Put a vector arrow over a symbol", expansion: "\\vec{${1}}", built_in: true },
      { id: "default-dot", name: "Dot", aliases: %w[dot], prefix: ".", description: "Put a dot over a symbol", expansion: "\\dot{${1}}", built_in: true },
      { id: "default-bar", name: "Bar", aliases: %w[bar], prefix: ".", description: "Put a bar over a symbol", expansion: "\\bar{${1}}", built_in: true },
      { id: "default-underline", name: "Underline", aliases: %w[u underline], prefix: ".", description: "Underline a symbol", expansion: "\\underline{${1}}", built_in: true },
      { id: "default-overline", name: "Overline", aliases: %w[overline], prefix: ".", description: "Put a line over a symbol", expansion: "\\overline{${1}}", built_in: true },
      { id: "default-ddot", name: "Double dot", aliases: %w[ddot], prefix: ".", description: "Put two dots over a symbol", expansion: "\\ddot{${1}}", built_in: true },
      { id: "default-check", name: "Check", aliases: %w[check], prefix: ".", description: "Put a check accent over a symbol", expansion: "\\check{${1}}", built_in: true },
      { id: "default-blackboard", name: "Blackboard bold", aliases: %w[blackboard], prefix: ".", description: "Use blackboard bold typography", expansion: "\\mathbb{${1}}", built_in: true },
      { id: "default-calligraphic", name: "Calligraphic", aliases: %w[cal calligraphic], prefix: ".", description: "Use calligraphic typography", expansion: "\\mathcal{${1}}", built_in: true },
      { id: "default-roman", name: "Roman", aliases: %w[rm roman], prefix: ".", description: "Use upright roman typography", expansion: "\\mathrm{${1}}", built_in: true },
      { id: "default-sans", name: "Sans serif", aliases: %w[sf sans], prefix: ".", description: "Use sans-serif typography", expansion: "\\mathsf{${1}}", built_in: true },
      { id: "default-mono", name: "Monospace", aliases: %w[tt mono], prefix: ".", description: "Use monospace typography", expansion: "\\mathtt{${1}}", built_in: true },
      { id: "default-alpha", name: "Alpha", aliases: %w[a alpha], prefix: "@", description: "Greek alpha", expansion: "\\alpha", built_in: true },
      { id: "default-beta", name: "Beta", aliases: %w[beta], prefix: "@", description: "Greek beta", expansion: "\\beta", built_in: true },
      { id: "default-gamma", name: "Gamma", aliases: %w[g gamma], prefix: "@", description: "Greek gamma", expansion: "\\gamma", built_in: true },
      { id: "default-delta", name: "Delta", aliases: %w[d delta], prefix: "@", description: "Greek delta", expansion: "\\delta", built_in: true },
      { id: "default-epsilon", name: "Epsilon", aliases: %w[e epsilon], prefix: "@", description: "Greek epsilon", expansion: "\\epsilon", built_in: true },
      { id: "default-zeta", name: "Zeta", aliases: %w[z zeta], prefix: "@", description: "Greek zeta", expansion: "\\zeta", built_in: true },
      { id: "default-eta", name: "Eta", aliases: %w[h eta], prefix: "@", description: "Greek eta", expansion: "\\eta", built_in: true },
      { id: "default-theta", name: "Theta", aliases: %w[th theta], prefix: "@", description: "Greek theta", expansion: "\\theta", built_in: true },
      { id: "default-iota", name: "Iota", aliases: %w[i iota], prefix: "@", description: "Greek iota", expansion: "\\iota", built_in: true },
      { id: "default-kappa", name: "Kappa", aliases: %w[k kappa], prefix: "@", description: "Greek kappa", expansion: "\\kappa", built_in: true },
      { id: "default-lambda", name: "Lambda", aliases: %w[l lambda], prefix: "@", description: "Greek lambda", expansion: "\\lambda", built_in: true },
      { id: "default-mu", name: "Mu", aliases: %w[m mu], prefix: "@", description: "Greek mu", expansion: "\\mu", built_in: true },
      { id: "default-nu", name: "Nu", aliases: %w[n nu], prefix: "@", description: "Greek nu", expansion: "\\nu", built_in: true },
      { id: "default-xi", name: "Xi", aliases: %w[x xi], prefix: "@", description: "Greek xi", expansion: "\\xi", built_in: true },
      { id: "default-pi", name: "Pi", aliases: %w[p pi], prefix: "@", description: "Greek pi", expansion: "\\pi", built_in: true },
      { id: "default-rho", name: "Rho", aliases: %w[r rho], prefix: "@", description: "Greek rho", expansion: "\\rho", built_in: true },
      { id: "default-sigma", name: "Sigma", aliases: %w[s sigma], prefix: "@", description: "Greek sigma", expansion: "\\sigma", built_in: true },
      { id: "default-tau", name: "Tau", aliases: %w[t tau], prefix: "@", description: "Greek tau", expansion: "\\tau", built_in: true },
      { id: "default-upsilon", name: "Upsilon", aliases: %w[u upsilon], prefix: "@", description: "Greek upsilon", expansion: "\\upsilon", built_in: true },
      { id: "default-phi", name: "Phi", aliases: %w[ph phi], prefix: "@", description: "Greek phi", expansion: "\\phi", built_in: true },
      { id: "default-chi", name: "Chi", aliases: %w[c chi], prefix: "@", description: "Greek chi", expansion: "\\chi", built_in: true },
      { id: "default-psi", name: "Psi", aliases: %w[y psi], prefix: "@", description: "Greek psi", expansion: "\\psi", built_in: true },
      { id: "default-omega", name: "Omega", aliases: %w[o omega], prefix: "@", description: "Greek omega", expansion: "\\omega", built_in: true },
      { id: "default-nabla", name: "Nabla", aliases: %w[nabla grad del], prefix: "@", description: "Gradient or del operator", expansion: "\\nabla", built_in: true },
      { id: "default-to", name: "Right arrow", aliases: %w[to rightarrow], prefix: "@", description: "Right-pointing relation", expansion: "\\to", built_in: true },
      { id: "default-longrightarrow", name: "Long right arrow", aliases: %w[longrightarrow longright lra], prefix: "@", description: "Long right-pointing arrow", expansion: "\\longrightarrow", built_in: true },
      { id: "default-implies", name: "Implies", aliases: %w[implies], prefix: "@", description: "Logical implication arrow", expansion: "\\implies", built_in: true },
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
      { id: "default-equiv", name: "Equivalent", aliases: %w[equiv equivalent], prefix: "@", description: "Equivalent relation", expansion: "\\equiv", built_in: true },
      { id: "default-sim", name: "Similar", aliases: %w[sim similar], prefix: "@", description: "Similarity relation", expansion: "\\sim", built_in: true },
      { id: "default-propto", name: "Proportional", aliases: %w[propto proportional], prefix: "@", description: "Proportionality relation", expansion: "\\propto", built_in: true },
      { id: "default-perp", name: "Perpendicular", aliases: %w[perp perpendicular], prefix: "@", description: "Perpendicular relation", expansion: "\\perp", built_in: true },
      { id: "default-subseteq", name: "Subset or equal", aliases: %w[subseteq], prefix: "@", description: "Subset-or-equal relation", expansion: "\\subseteq", built_in: true },
      { id: "default-supseteq", name: "Superset or equal", aliases: %w[supseteq], prefix: "@", description: "Superset-or-equal relation", expansion: "\\supseteq", built_in: true },
      { id: "default-cup", name: "Union", aliases: %w[cup union], prefix: "@", description: "Set union", expansion: "\\cup", built_in: true },
      { id: "default-cap", name: "Intersection", aliases: %w[cap intersection], prefix: "@", description: "Set intersection", expansion: "\\cap", built_in: true },
      { id: "default-ldots", name: "Ellipsis", aliases: %w[ldots dots], prefix: "@", description: "Mathematical ellipsis", expansion: "\\ldots", built_in: true },
      { id: "default-log", name: "Logarithm", aliases: %w[log logarithm], prefix: "@", description: "Logarithm operator", expansion: "\\log", built_in: true },
      { id: "default-ln", name: "Natural logarithm", aliases: %w[ln], prefix: "@", description: "Natural logarithm operator", expansion: "\\ln", built_in: true },
      { id: "default-exp", name: "Exponential", aliases: %w[exp exponential], prefix: "@", description: "Exponential operator", expansion: "\\exp", built_in: true },
      { id: "default-sin", name: "Sine", aliases: %w[sin], prefix: "@", description: "Sine operator", expansion: "\\sin", built_in: true },
      { id: "default-cos", name: "Cosine", aliases: %w[cos], prefix: "@", description: "Cosine operator", expansion: "\\cos", built_in: true },
      { id: "default-tan", name: "Tangent", aliases: %w[tan], prefix: "@", description: "Tangent operator", expansion: "\\tan", built_in: true },
      { id: "default-frac", name: "Fraction", aliases: %w[frac fraction], prefix: "@", description: "Fraction with numerator and denominator", expansion: "\\frac{${1}}{${2}}", built_in: true },
      { id: "default-sqrt", name: "Square root", aliases: %w[sqrt root], prefix: "@", description: "Square root with one slot", expansion: "\\sqrt{${1}}", built_in: true },
      { id: "default-binomial", name: "Binomial", aliases: %w[binom choose], prefix: "@", description: "Binomial coefficient", expansion: "\\binom{${1}}{${2}}", built_in: true },
      { id: "default-int-bounds", name: "Bounded integral", aliases: %w[intb integralbounds], prefix: "@", description: "Integral with lower and upper bounds", expansion: "\\int_{${1}}^{${2}}", built_in: true },
      { id: "default-sum-bounds", name: "Bounded sum", aliases: %w[sumb summationbounds], prefix: "@", description: "Sum with lower and upper bounds", expansion: "\\sum_{${1}}^{${2}}", built_in: true },
      { id: "default-left-parens", name: "Parentheses", aliases: %w[paren parentheses], prefix: "@", description: "Sized parentheses around an expression", expansion: "\\left( ${1} \\right)", built_in: true },
      { id: "default-absolute", name: "Absolute value", aliases: %w[abs absolute], prefix: "@", description: "Sized absolute value bars", expansion: "\\left| ${1} \\right|", built_in: true },
      { id: "default-norm", name: "Norm", aliases: %w[norm], prefix: "@", description: "Sized norm bars", expansion: "\\left\\| ${1} \\right\\|", built_in: true }
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
      persisted_aliases = persisted.flat_map { |shortcut| shortcut[:aliases].map { |alias_name| [shortcut[:prefix], alias_name] } }
      defaults = DEFAULTS.reject do |shortcut|
        shortcut[:aliases].any? { |alias_name| persisted_aliases.include?([shortcut[:prefix], alias_name]) }
      end
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
