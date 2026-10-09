module Snippets
  class Catalog
    DEFAULTS = [
      { id: "default-bold", name: "Bold text", trigger: "bold", description: "Emphasized Markdown text", category: "Markdown", body: "**${1:text}**", built_in: true },
      { id: "default-image", name: "Image", trigger: "image", description: "Markdown image", category: "Markdown", body: "![${1:description}](${2:image URL})", built_in: true },
      { id: "default-table", name: "Table", trigger: "table", description: "Markdown table", category: "Markdown", body: "| ${1:Column 1} | ${2:Column 2} |\n| --- | --- |\n| ${3:Value 1} | ${4:Value 2} |", built_in: true },
      { id: "default-code", name: "Code block", trigger: "code", description: "Fenced code block", category: "Markdown", body: "```\n${1:code}\n```", built_in: true },
      { id: "default-quote", name: "Quote", trigger: "quote", description: "Markdown blockquote", category: "Markdown", body: "> ${1:quoted text}", built_in: true },
      { id: "default-callout", name: "Callout", trigger: "callout", description: "Highlighted callout", category: "Markdown", body: "> [!NOTE]\n> ${1:Callout text}", built_in: true },
      { id: "default-columns", name: "Columns", trigger: "columns", description: "Two-column layout", category: "Markdown", body: "| ${1:Left column} | ${2:Right column} |\n| --- | --- |", built_in: true },
      { id: "default-slide", name: "Slide", trigger: "slide", description: "Start a new slide", category: "Markdown", body: "---\n\n# ${1:Slide title}\n\n${2:Content}", built_in: true },
      { id: "default-section", name: "Section", trigger: "section", description: "Markdown section heading", category: "Markdown", body: "## ${1:Section title}", built_in: true },
      { id: "default-footnote", name: "Footnote", trigger: "footnote", description: "Elef footnote directive", category: "Markdown", body: ":::footnote{${1:Footnote text}}", built_in: true },
      { id: "default-equation", name: "Equation", trigger: "equation", description: "Display math equation", category: "LaTeX", body: "$$\n${1:equation}\n$$", built_in: true },
      { id: "default-diagram", name: "Diagram", trigger: "diagram", description: "Mermaid diagram", category: "Mermaid", body: "```mermaid\n${1:flowchart TD}\n  ${2:A --> B}\n```", built_in: true },
      { id: "default-list", name: "Bullet list", trigger: "list", description: "A short Markdown list", category: "Markdown", body: "- ${1:first item}\n- ${2:second item}", built_in: true },
      { id: "default-bit", name: "Bullet list (BIT)", trigger: "bit", description: "A short Markdown bullet list", category: "Markdown", body: "- ${1:first item}\n- ${2:second item}", built_in: true },
      { id: "default-ben", name: "Numbered list (BEN)", trigger: "ben", description: "A short Markdown numbered list", category: "Markdown", body: "1. ${1:first item}\n2. ${2:second item}", built_in: true },
      { id: "default-bfr", name: "Slide frame", trigger: "bfr", description: "A titled presentation section", category: "Markdown", body: "## ${1:title}\n\n${2:content}", built_in: true },
      { id: "default-bfi", name: "Figure", trigger: "bfi", description: "A Markdown image", category: "Markdown", body: "![${1:description}](${2:image URL})", built_in: true },
      { id: "default-bta", name: "Table", trigger: "bta", description: "A small Markdown table", category: "Markdown", body: "| ${1:Column 1} | ${2:Column 2} |\n| --- | --- |\n| ${3:Value 1} | ${4:Value 2} |", built_in: true },
      { id: "default-beq", name: "Display equation", trigger: "beq", description: "A block LaTeX equation", category: "LaTeX", body: "$$\n${1:equation}\n$$", built_in: true },
      { id: "default-bseq", name: "Display equation (starred)", trigger: "bseq", description: "A block equation without numbering", category: "LaTeX", body: "$$\n${1:equation}\n$$", built_in: true },
      { id: "default-bga", name: "Gathered equations (BGA)", trigger: "bga", description: "A block of gathered equations", category: "LaTeX", body: "$$\n\\begin{gathered}\n${1:equation}\n\\end{gathered}\n$$", built_in: true },
      { id: "default-bsga", name: "Gathered equations (starred)", trigger: "bsga", description: "A block of unnumbered gathered equations", category: "LaTeX", body: "$$\n\\begin{gathered}\n${1:equation}\n\\end{gathered}\n$$", built_in: true },
      { id: "default-bal", name: "Aligned equations (BAL)", trigger: "bal", description: "A block of aligned equations", category: "LaTeX", body: "$$\n\\begin{aligned}\n${1:left} & = ${2:right}\\\\\n${3:next line}\n\\end{aligned}\n$$", built_in: true },
      { id: "default-bsal", name: "Aligned equations (starred)", trigger: "bsal", description: "A block of unnumbered aligned equations", category: "LaTeX", body: "$$\n\\begin{aligned}\n${1:left} & = ${2:right}\\\\\n${3:next line}\n\\end{aligned}\n$$", built_in: true },
      { id: "default-bspl", name: "Split equation (BSPL)", trigger: "bspl", description: "A multi-line split equation", category: "LaTeX", body: "$$\n\\begin{split}\n${1:left} & = ${2:right}\\\\\n${3:next line}\n\\end{split}\n$$", built_in: true },
      { id: "default-bcas", name: "Cases (BCAS)", trigger: "bcas", description: "A piecewise cases expression", category: "LaTeX", body: "$$\n\\begin{cases}\n${1:value} & ${2:condition}\\\\\n${3:otherwise} & ${4:condition}\n\\end{cases}\n$$", built_in: true },
      { id: "default-bmat", name: "Matrix (BMAT)", trigger: "bmat", description: "A two-by-two matrix", category: "LaTeX", body: "$$\n\\begin{bmatrix}\n${1:a} & ${2:b}\\\\\n${3:c} & ${4:d}\n\\end{bmatrix}\n$$", built_in: true },
      { id: "default-bpm", name: "Parenthesized matrix (BPM)", trigger: "bpm", description: "A two-by-two parenthesized matrix", category: "LaTeX", body: "$$\n\\begin{pmatrix}\n${1:a} & ${2:b}\\\\\n${3:c} & ${4:d}\n\\end{pmatrix}\n$$", built_in: true },
      { id: "default-bvm", name: "Determinant matrix (BVM)", trigger: "bvm", description: "A two-by-two determinant matrix", category: "LaTeX", body: "$$\n\\begin{vmatrix}\n${1:a} & ${2:b}\\\\\n${3:c} & ${4:d}\n\\end{vmatrix}\n$$", built_in: true },
      { id: "default-ieq", name: "Inline equation", trigger: "ieq", description: "An inline LaTeX equation", category: "LaTeX", body: "$\n${1:equation}\n$", built_in: true },
      { id: "default-frac", name: "Fraction", trigger: "frac", description: "A fraction with numerator and denominator", category: "LaTeX", body: "\\frac{${1:numerator}}{${2:denominator}}", built_in: true },
      { id: "default-sqrt", name: "Square root", trigger: "sqrt", description: "A square root", category: "LaTeX", body: "\\sqrt{${1:expression}}", built_in: true },
      { id: "default-sup", name: "Superscript", trigger: "sup", description: "A superscript", category: "LaTeX", body: "^{${1:power}}", built_in: true },
      { id: "default-sub", name: "Subscript", trigger: "sub", description: "A subscript", category: "LaTeX", body: "_{${1:index}}", built_in: true },
      { id: "default-mtext", name: "Text in math", trigger: "mtext", description: "Readable text inside math", category: "LaTeX", body: "\\text{${1:text}}", built_in: true },
      { id: "default-align", name: "Align directive", trigger: "align", description: "Align a block horizontally or vertically", category: "Elef DSL", body: ":::align{${1}}", built_in: true },
      { id: "default-art", name: "Art list", trigger: "art", description: "Render a Markdown list as semantic Art", category: "Elef DSL", body: ":::art", built_in: true },
      { id: "default-sse", name: "Section directive", trigger: "sse", description: "Create a section", category: "Elef DSL", body: ":::section{${1:section name}}", built_in: true },
      { id: "default-sss", name: "Subsection directive", trigger: "sss", description: "Create a subsection", category: "Elef DSL", body: ":::subsection{${1:subsection name}}", built_in: true },
      { id: "default-foot", name: "Footnote directive", trigger: "foot", description: "Add a footnote", category: "Elef DSL", body: ":::footnote{${1:footnote text}}", built_in: true }
    ].freeze
    PLACEHOLDER = /\$\{(\d+)(?::([^}]*))?\}/.freeze

    def self.all
      Snippet.ordered
    end

    def self.for_editor
      persisted = all.map do |snippet|
        {
          id: snippet.id,
          name: snippet.name,
          trigger: snippet.trigger,
          description: snippet.description,
          category: snippet.category,
          body: snippet.body
        }
      end
      persisted_keys = persisted.map { |snippet| [snippet[:trigger], snippet[:name]] }
      defaults = DEFAULTS.reject { |snippet| persisted_keys.include?([snippet[:trigger], snippet[:name]]) }
      defaults + persisted
    end

    def self.expand(body)
      text = body.to_s
      stops = []
      offset = 0
      expanded = text.gsub(PLACEHOLDER) do
        match = Regexp.last_match
        number = match[1].to_i
        value = match[2].to_s
        start = match.begin(0) + offset
        offset += value.length - match[0].length
        stops << { number: number, start: start, length: value.length }
        value
      end
      { text: expanded, stops: stops.sort_by { |stop| stop[:number].zero? ? Float::INFINITY : stop[:number] } }
    end
  end
end
