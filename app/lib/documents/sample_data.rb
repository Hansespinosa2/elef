module Documents
  module SampleData
    module_function

    Conflict = Data.define(:sample_id, :title, :existing_document)
    LoadResult = Data.define(:records, :conflicts)

    SAMPLES = [
      {
        id: "document-markdown-tour",
        title: "Fixture: Markdown tour",
        purpose: "Prove continuous Markdown semantics, hierarchy, emphasis, lists, links, and thematic breaks.",
        source: <<~MARKDOWN
          ---
          presentationTheme: light
          presentationTypography: modern
          ---
          # Fixture: Markdown tour

          This polished document exercises the Markdown that authors use most:
          **emphasis**, *qualification*, ~~intentional change~~, and `inline code`.

          ## Structure carries the argument

          A long-form document keeps its story continuous while headings make
          the shape visible to readers who are scanning for a specific idea.

          - Start with the question.
          - Name the evidence.
          - Make the decision explicit.

          1. Gather context.
          2. Compare options.
          3. Record what changed.

          > The best source is readable before it is rendered.

          Links should provide a useful next step: [visit the Elef project](https://example.com/elef).

          ---

          ## A continuous source

          The horizontal rule above is content in a document. It should become
          a rendered divider rather than splitting this document into slides.
        MARKDOWN
      },
      {
        id: "document-components",
        title: "Fixture: Rich components",
        purpose: "Prove tables, fenced code, inline and display math, and safe media in a document.",
        source: <<~MARKDOWN
          ---
          presentationTheme: match
          ---
          # Fixture: Rich components

          Documents can combine prose with the same semantic content used by
          presentations without losing their continuous reading flow.

          ## Compare the choices

          | Approach | Authoring speed | Reviewability | Risk |
          | --- | ---: | ---: | ---: |
          | Markdown first | High | High | Low |
          | Export first | Low | Medium | Medium |
          | Design first | Medium | Low | High |

          ## Show an implementation

          ```ruby
          document = Document.find_by!(title: "Fixture: Rich components")
          render(document.source)
          ```

          ## Explain the model

          The relationship is $E = mc^2$ in inline form, while this display
          equation gives the reader a larger landmark:

          $$\\frac{1}{3} + x^2 + y_1$$

          ![A representative workflow diagram](https://example.com/elef-workflow.png)

          The image, table, code, and equations all remain ordinary Markdown.
        MARKDOWN
      },
      {
        id: "document-positioned-content",
        title: "Fixture: Positioned content",
        purpose: "Prove document block positioning without exposing the positioning directive.",
        source: <<~MARKDOWN
          ---
          presentationTheme: dark
          ---
          # Fixture: Positioned content

          Position directives are useful when a document needs a deliberately
          composed block while the surrounding source stays easy to read.

          :::position{left top}

          ### Left and top

          This block demonstrates the first supported alignment combination.

          :::position{center middle}

          ### Center and middle

          This block is centered within the document preview.

          :::position{right bottom}

          ### Right and bottom

          This block demonstrates the opposite corner.

          The directive itself is presentation syntax and should not leak into
          the rendered HTML.
        MARKDOWN
      },
      {
        id: "document-boundaries",
        title: "Fixture: Markdown boundaries",
        purpose: "Prove front matter, thematic breaks, fenced delimiters, Unicode, and wrapping.",
        source: <<~MARKDOWN
          ---
          presentationTheme: match
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          # Fixture: Markdown boundaries

          A delimiter-looking line inside a document is a horizontal rule:

          ---

          The same text inside fenced code is data and must remain untouched.

          ```yaml
          ---
          layout: document
          features:
            - links
            - math
          ```

          ~~~text
          ---
          ~~~

          Unicode, punctuation, and long lines should preserve their meaning:
          café — naïve façade • “quoted” text • 日本語 • 🚀. This intentionally
          long sentence gives wrapping and typography enough material to expose
          accidental clipping or an overly narrow reading measure.
        MARKDOWN
      },
      {
        id: "document-links-hub",
        title: "Fixture: Link hub",
        purpose: "Prove a high-degree graph node and duplicate-edge deduplication.",
        source: <<~MARKDOWN
          # Fixture: Link hub

          This hub points to [[Fixture: Link branch A]], [[Fixture: Link branch B]],
          and [[Fixture: Link cycle A]]. It gives the document graph a central
          node with several different kinds of neighbors.

          The same link appears twice: [[Fixture: Link branch A]]. The graph
          should keep one edge for the repeated relationship.
        MARKDOWN
      },
      {
        id: "document-links-branch-a",
        title: "Fixture: Link branch A",
        purpose: "Prove a linked branch can return to the hub and continue to another branch.",
        source: <<~MARKDOWN
          # Fixture: Link branch A

          This branch returns to [[Fixture: Link hub]] and continues to
          [[Fixture: Link branch B]]. Resolved links should remain ordinary
          Markdown content with a navigable document target.
        MARKDOWN
      },
      {
        id: "document-links-branch-b",
        title: "Fixture: Link branch B",
        purpose: "Prove a second branch remains legible and independently navigable.",
        source: <<~MARKDOWN
          # Fixture: Link branch B

          This branch points back to [[Fixture: Link hub]]. Its short source
          keeps the graph example legible while still making the branch visible.
        MARKDOWN
      },
      {
        id: "document-links-cycle-a",
        title: "Fixture: Link cycle A",
        purpose: "Prove one half of a reciprocal document cycle remains renderable.",
        source: <<~MARKDOWN
          # Fixture: Link cycle A

          The first half of a deliberate cycle links to [[Fixture: Link cycle B]].
        MARKDOWN
      },
      {
        id: "document-links-cycle-b",
        title: "Fixture: Link cycle B",
        purpose: "Prove reciprocal cycles do not recurse or duplicate graph nodes.",
        source: <<~MARKDOWN
          # Fixture: Link cycle B

          The second half links back to [[Fixture: Link cycle A]]. Cycles are
          valid relationships and should not make graph rendering recurse.
        MARKDOWN
      },
      {
        id: "document-links-unresolved",
        title: "Fixture: Unresolved links",
        purpose: "Prove resolved, unresolved, inline-code, and fenced-code link distinctions.",
        source: <<~MARKDOWN
          # Fixture: Unresolved links

          This document has one known target, [[Fixture: Link hub]], and one
          intentionally missing target, [[Fixture: Missing document]]. Missing
          links should be visible without becoming broken anchors.

          Inline code is not a relationship: `[[Fixture: Link branch A]]`.

          ```text
          [[Fixture: Link branch B]]
          ```
        MARKDOWN
      },
      {
        id: "document-links-orphan",
        title: "Fixture: Graph orphan",
        purpose: "Prove a standalone document remains visible in the graph without edges.",
        source: <<~MARKDOWN
          # Fixture: Graph orphan

          This document has no incoming or outgoing document links. It should
          remain visible as an orphan node in the document graph.
        MARKDOWN
      },
      {
        id: "document-stress-renderer",
        title: "Stress: Renderer kitchen sink",
        purpose: "Prove combined content types, wrapping, and generated HTML under density.",
        source: <<~MARKDOWN
          ---
          presentationTheme: match
          ---
          # Stress: Renderer kitchen sink

          This deliberately dense document combines the content types most
          likely to expose interactions between typography, whitespace, and
          generated HTML.

          **Bold text**, *italic text*, `code`, [a link](https://example.com/contracts),
          and an image should all retain clear boundaries.

          $$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$

          | Layer | Responsibility |
          | --- | --- |
          | Model | Preserve raw Markdown |
          | Parser | Derive document structure |
          | Renderer | Produce safe HTML |

          ```ruby
          formula = "$x^2$"
          puts "The code fence keeps the formula literal: \#{formula}"
          ```

          ![Stress-test diagram](https://example.com/stress-test-diagram.png)

          A long paragraph exercises wrapping, generated markup, and the
          relationship between source whitespace and the final reading surface.
          The content is intentionally substantial enough to make regressions
          visible without requiring an external asset or network request.
        MARKDOWN
      },
      {
        id: "document-stress-warnings",
        title: "Stress: Warnings and unsafe input",
        purpose: "Prove malformed directives warn locally and unsafe protocols are removed.",
        source: <<~MARKDOWN
          # Stress: Warnings and unsafe input

          The document renderer should remove unsupported directives locally and
          report what it removed rather than silently presenting misleading HTML.

          :::unknown

          Content after an unknown directive remains readable.

          :::position{diagonal}

          This malformed position should produce a warning.

          :::position{left

          This incomplete directive is another malformed boundary.

          [unsafe link](javascript:alert(1))

          ![unsafe image](javascript:alert(1))

          [[Fixture: Missing document]]
        MARKDOWN
      }
    ].freeze

    def load!
      conflicts = SAMPLES.filter_map do |sample|
        existing_document = Document.find_by(sample_id: nil, title: sample[:title])
        next unless existing_document

        Conflict.new(sample[:id], sample[:title], existing_document)
      end
      conflicted_sample_ids = conflicts.each_with_object({}) do |conflict, sample_ids|
        sample_ids[conflict.sample_id] = true
      end

      records = Document.transaction do
        SAMPLES.map do |sample|
          next if conflicted_sample_ids[sample[:id]]

          document = Document.find_or_initialize_by(sample_id: sample[:id])
          document.assign_attributes(title: sample[:title], source: sample[:source])
          document.save!
          document
        end.compact
      end

      LoadResult.new(records, conflicts)
    end
  end
end
