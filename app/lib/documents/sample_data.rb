module Documents
  module SampleData
    module_function

    SAMPLES = [
      {
        id: "document-markdown-tour",
        title: "Fixture: Markdown tour",
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
        source: <<~MARKDOWN
          # Fixture: Link branch B

          This branch points back to [[Fixture: Link hub]]. Its short source
          keeps the graph example legible while still making the branch visible.
        MARKDOWN
      },
      {
        id: "document-links-cycle-a",
        title: "Fixture: Link cycle A",
        source: <<~MARKDOWN
          # Fixture: Link cycle A

          The first half of a deliberate cycle links to [[Fixture: Link cycle B]].
        MARKDOWN
      },
      {
        id: "document-links-cycle-b",
        title: "Fixture: Link cycle B",
        source: <<~MARKDOWN
          # Fixture: Link cycle B

          The second half links back to [[Fixture: Link cycle A]]. Cycles are
          valid relationships and should not make graph rendering recurse.
        MARKDOWN
      },
      {
        id: "document-links-unresolved",
        title: "Fixture: Unresolved links",
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
        source: <<~MARKDOWN
          # Fixture: Graph orphan

          This document has no incoming or outgoing document links. It should
          remain visible as an orphan node in the document graph.
        MARKDOWN
      },
      {
        id: "document-stress-renderer",
        title: "Stress: Renderer kitchen sink",
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
      Document.transaction do
        SAMPLES.map do |sample|
          document = Document.find_or_initialize_by(sample_id: sample[:id])
          document.assign_attributes(title: sample[:title], source: sample[:source])
          document.save!
          document
        end
      end
    end
  end
end
