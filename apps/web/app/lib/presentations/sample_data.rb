module Presentations
  module SampleData
    module_function

    MARKER_KEY = "elefSampleId"

    SAMPLES = [
      {
        id: "markdown-basics",
        title: "Sample: Markdown basics",
        purpose: "Prove Markdown hierarchy, sections, subsections, footnotes, slide counts, and readable narrative flow.",
        source: <<~MARKDOWN
          ---
          #{MARKER_KEY}: markdown-basics
          theme: light
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Markdown fundamentals}
          :::subsection{Build a clear story}
          # Markdown in practice

          A complete tour of the writing patterns that make a presentation easy
          to follow: structure, emphasis, pacing, and useful examples.
          :::footnote{Elef treats raw Markdown as the source of truth.}
          ---
          # Start with a clear promise

          A strong opening tells the audience what they will understand by the
          end of the talk.

          - Name the problem.
          - Explain why it matters now.
          - Show the path from question to decision.
          ---
          :::subsection{Make hierarchy visible}
          # Make hierarchy visible

          Headings provide the outline, while paragraphs carry the argument.
          Keep one main idea on each slide and use short supporting sections to
          make scanning effortless.

          **Rule of thumb:** if the title cannot summarize the slide, the slide
          probably contains two ideas.
          ---
          # Emphasis guides attention

          Use **bold** for a decision, *italics* for a qualification, and
          ~~strikethrough~~ to show an intentional change.

          > Good presentation writing is about making the important parts
          > impossible to miss.
          ---
          # Lists turn detail into rhythm

          1. Introduce the context.
          2. Name the tension.
          3. Compare the options.
          4. Make the recommendation.

          Numbered lists work when order matters; bullets work when items stand
          independently.
          ---
          # Links should earn their space

          A link is most useful when it gives the audience a next step:
          [read the Elef project notes](https://example.com/elef-notes).

          Put the claim on the slide and use the link for evidence or context.
          ---
          # Use a short example

          Imagine a team reviewing a release plan. The title states the
          decision, the paragraph gives context, and the bullets show the
          trade-offs.

          This makes the slide useful while presenting and later, when someone
          reads it without narration.
          ---
          # Markdown is the source of truth

          The raw document stays editable and portable. Slides are derived from
          the source by splitting sections at standalone separators.

          The author can review the complete story in one place without losing
          the presentation view.
          ---
          # A deliberate ending

          Summarize the decision in one sentence, then give the audience a
          concrete action:

          - revisit the opening question;
          - name what changed;
          - say what happens next.
          ---
          # Takeaway

          A good Markdown deck is a readable document first and a visual
          presentation second.

          When structure, emphasis, examples, and pacing are clear in the
          source, the rendered slides have a strong foundation.
        MARKDOWN
      },
      {
        id: "layouts-and-themes",
        title: "Sample: Layouts and themes",
        purpose: "Prove themes, automatic layouts, columns, centered content, and every supported position.",
        source: <<~MARKDOWN
          ---
          #{MARKER_KEY}: layouts-and-themes
          theme: dark
          ---
          :::align{center center}
          # Designing a visual system

          :::align {center}
          This deck exercises automatic layouts while telling a complete story
          about consistent presentation design.
          ---
          # Why consistency matters

          Consistency reduces the interpretation an audience must do. Repeated
          patterns create room for the ideas themselves to stand out.

          - stable placement;
          - predictable hierarchy;
          - intentional contrast.
          ---
          # Establish a visual contract

          ## Source

          A theme is a contract between the document and its audience.

          ## Theme

          The content should remain understandable if the visual system changes.
          ---
          # Opening slides create orientation

          A short statement gives a major section room to breathe. Use it for a
          new chapter, a key question, or a transition in the narrative.

          It should not be used merely because a slide has a large heading.
          ---
          # Body slides carry evidence

          The `body` layout is the workhorse: paragraphs, lists, examples, and
          comparisons all belong here.

          Keep the title specific enough that the audience knows what evidence
          to look for.
          ---
          # Contrast supports comprehension

          ## Readability

          Dark themes can create focus, but contrast still needs to be tested.

          ## Meaning

          Primary text, muted text, links, and code need distinct boundaries.

          ## Consistency

          Every choice should remain legible when the audience is far away.
          ---
          # Theme and content stay separate

          A deck can move from dark to light without changing its Markdown.
          That separation lets the author focus on meaning while the renderer
          handles presentation details.
          ---
          # A layout is not a template prison

          Layout metadata describes intent, not a fixed set of words. A body
          slide can contain a table or code block; an intro slide can still
          include a concise supporting sentence.
          ---
          # Use transitions intentionally

          A section transition should answer one question: why are we moving
          here now?

          The strongest transitions connect the previous conclusion to the next
          investigation.
          ---
          # Review the whole arc

          :::align{center center}

          Before presenting, check the sequence at thumbnail scale:

          1. Does the visual rhythm vary?
          2. Are chapters easy to find?
          3. Does the final slide resolve the opening promise?
          ---
          # Design system takeaway

          Themes provide atmosphere, layouts provide intent, and Markdown
          provides the content. Keeping those responsibilities separate makes the deck easier to edit and easier for Elef to render.
          ---
          # Two columns with independent positions

          ## Bullets

          :::align{center center}

          - Center the important points.
          - Keep the list easy to scan.

          ## Code

          :::align{bottom right}

          ```ruby
          layout = infer_layout(document)
          render(layout)
          ```
          ---
          # Three columns at a glance

          ## First

          :::align{top left}

          Start with the question.

          ## Second

          :::align{center center}

          Compare the alternatives.

          ## Third

          :::align{bottom right}

          Make the decision.
          ---
          # Horizontal positions

          ## Left

          :::align{top left}

          Left aligned.

          ## Center

          :::align{top center}

          Center aligned.

          ## Right

          :::align{top right}

          Right aligned.
          ---
          # Vertical positions

          ## Top

          :::align{top left}

          Top aligned.

          ## Middle

          :::align{center left}

          Middle aligned.

          ## Bottom

          :::align{bottom center}

          Bottom aligned.
          ---
          # More position combinations

          ## Lower left

          :::align{bottom left}

          Lower-left content.

          ## Center right

          :::align{center right}

          Middle-right content.

          ## Lower center

          :::align{bottom center}

          Lower-center content.
        MARKDOWN
      },
      {
        id: "code-and-math",
        title: "Sample: Code and LaTeX math",
        purpose: "Prove syntax-highlighted code stays distinct from inline and display LaTeX math.",
        source: <<~MARKDOWN
          ---
          #{MARKER_KEY}: code-and-math
          theme: match
          ---
          # Reasoning with code and math

          A technical presentation needs more than a code sample. It needs a
          progression from the question, through the model, to the result.
          ---
          # Begin with the question

          How can we estimate the cost of processing a growing collection?

          We will compare a simple loop, a measured implementation, and a
          mathematical model that explains the observed behavior.
          ---
          # A small Ruby experiment

          ```ruby
          samples = [10, 100, 1_000, 10_000]
          samples.each do |size|
            elapsed = measure { process_records(size) }
            puts "\#{size}: \#{elapsed.round(2)} ms"
          end
          puts "$not_math$"
          ```

          Fenced content remains code rather than becoming presentation math.
          ---
          # State the model

          For a linear pass through `n` records, the work grows approximately as
          \(T(n) = an + b\). Inline check: $x^2 + y_1$.

          The constants describe fixed setup work and the cost per record.
          ---
          # Display the relationship

          $$T(n) = an + b$$

          This equation is intentionally displayed as block math so its
          spacing and alignment can be inspected in the browser.
          ---
          # A useful comparison

          The difference between linear and quadratic work becomes visible as
          the input grows:

          $$\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}$$

          A compact formula can explain why a small design choice becomes
          expensive at scale.
          ---
          # Read the output carefully

          ```ruby
          result = records
            .select { |record| record.active? }
            .group_by(&:category)
            .transform_values(&:count)
          ```
          ---
          # Put limits where they belong

          With a constrained input, a simple implementation may be exactly
          right. With an unbounded input, the same implementation can become a
          reliability risk.

          $$\\lim_{n\\to\\infty} \\frac{1}{n} = 0$$
          ---
          # Explain assumptions

          A benchmark is not a proof. Record the environment, input shape, and
          warm-up behavior so the audience knows what the numbers mean.

          - same dataset;
          - same Ruby version;
          - repeated measurements;
          - reported units.
          ---
          # Technical takeaway

          Code shows what the system does. Math explains why the behavior
          changes. A strong technical deck uses both to make a decision
          reviewable.
        MARKDOWN
      },
      {
        id: "tables-and-media",
        title: "Sample: Tables and media",
        purpose: "Prove table layout, image rendering, safe links, and evidence-oriented content.",
        source: <<~MARKDOWN
          ---
          #{MARKER_KEY}: tables-and-media
          ---
          # Communicating a product decision

          A decision deck combines narrative, comparison, evidence, and a
          memorable conclusion. This one exercises tables, links, and images.
          ---
          # The decision in one sentence

          We need a presentation workflow that is fast to author, easy to
          review, and reliable to test.

          The recommendation is to keep Markdown canonical and derive every
          rendered view from it.
          ---
          # Compare the options

          | Workflow | Authoring speed | Reviewability | Testability |
          | --- | ---: | ---: | ---: |
          | Desktop-only | Medium | Low | Low |
          | Browser-first | High | High | High |
          | Export-first | Low | Medium | Medium |
          ---
          # What the audience needs

          A useful comparison does not hide its criteria. Explain the trade-off
          before showing the result, then make the recommended row easy to find.

          The table is evidence for a decision, not a substitute for one.
          ---
          # Show the workflow

          ![Elef authoring workflow](https://example.com/elef-workflow.png)

          The author edits one source, saves it, reviews the rendered slides,
          and opens the same saved source later.
          ---
          # Give the reader a next step

          The [Elef project documentation](https://example.com/elef) should
          answer implementation questions without forcing the reader to infer
          which choice the deck recommends.
          ---
          # Use images as evidence

          ![A representative slide canvas](https://example.com/slide-canvas.png)
          ---
          # Explain the cost

          | Investment | Benefit | Risk |
          | --- | --- | --- |
          | Seed library | Fast demos | Stale examples |
          | Browser tests | Regression confidence | Setup cost |
          | Raw source | Portability | Requires discipline |
          ---
          # Make uncertainty visible

          Every decision has assumptions. Name them explicitly:

          - the browser remains the primary authoring surface;
          - Markdown features stay intentionally bounded;
          - samples remain deterministic.
          ---
          # Close the loop

          The proposed workflow reduces the distance between authoring, review,
          and verification.

          The next experiment is small: load a representative library and run
          the same browser flow against every important content type.
          ---
          # Decision summary

          Choose the workflow that makes the result easiest to inspect.

          Tables compare, images orient, links extend the conversation, and
          narrative explains why the choice matters.
        MARKDOWN
      },
      {
        id: "slide-edge-cases",
        title: "Sample: Slide edge cases",
        purpose: "Prove slide boundaries, front matter, fenced delimiters, tilde fences, and unusual text.",
        source: <<~MARKDOWN
          ---
          #{MARKER_KEY}: slide-edge-cases
          theme: light
          ---
          # Stress testing the document boundary

          Real documents contain punctuation, fences, long lines, metadata, and
          empty-looking content. This deck makes those cases visible while
          keeping every slide useful.
          ---
          # A separator belongs to the document

          The standalone line below separates slides:

          `---`

          A separator inside prose, such as `---` between words, is ordinary
          content and should not split the document.
          ---
          # Fenced code can contain separators

          ```yaml
          ---
          title: "Still inside the example"
          items:
            - one
            - two
          ```

          The parser must keep the fence and its contents together.
          ---
          # Tilde fences work too

          ~~~javascript
          const divider = "---";
          console.log(divider);
          ~~~

          Different fence markers should remain balanced and should not change
          the surrounding slide boundaries.
          ---
          # Metadata comes before the story

          Front matter configures the deck:

          - `theme: light`
          - `elefSampleId: slide-edge-cases`

          The metadata is removed from rendered slide content.
          ---
          # Long lines should remain readable

          This paragraph is intentionally long enough to exercise wrapping,
          width constraints, and the relationship between source length and
          rendered slide geometry without relying on an artificial placeholder.
          ---
          # Punctuation is content

          Quotes, colons, braces, brackets, ampersands, and escaped characters
          should survive the Markdown pipeline:

          > "A boundary is only useful when it is explicit."
          ---
          # Empty-looking lines are not boundaries

          The following paragraph starts after several blank lines.



          The meaningful content remains part of the same slide.
          ---
          # Mixed inline content

          Combine **strong text**, *emphasis*, `inline code`, a
          [reference](https://example.com/reference), and
          \(x_1 + x_2 = x_3\) in one readable paragraph.

          Inline features should not interfere with one another.
          ---
          # Edge-case takeaway

          Boundaries should be predictable: metadata is scoped, fences are
          respected, and only standalone delimiters split slides.

          Predictability is what makes a source-first editor trustworthy.
        MARKDOWN
      },
      {
        id: "elef-workflow",
        title: "Sample: The Elef workflow",
        purpose: "Prove a realistic end-to-end story can combine authoring, preview, presentation, and review.",
        source: <<~MARKDOWN
          ---
          #{MARKER_KEY}: elef-workflow
          theme: dark
          ---
          # From source to stage

          A complete Elef workflow turns a Markdown document into a reviewable,
          presentable deck without losing the source that created it.
          ---
          # 1. Start with intent

          Define the audience and the decision they need to make. A title is a
          promise; the slides should keep it.

          **Audience:** teammates reviewing a product change.
          ---
          # 2. Draft the narrative

          Begin with headings and paragraphs. Add separators only when the story
          needs a new visual beat.

          ```markdown
          # The question

          What changed, and why should we trust it?
          ```
          ---
          # 3. Add evidence

          Evidence can be a code sample, a table, a measurement, or a link.
          Every artifact should answer a question raised by the narrative.

          | Claim | Evidence |
          | --- | --- |
          | The flow is repeatable | Browser test |
          | The source is preserved | Reloaded Markdown |
          ---
          # 4. Save deliberately

          An explicit save creates a stable checkpoint. The preview is derived
          from the saved source, so the author can compare what was written with
          what was rendered.
          ---
          # 5. Review the rendered result

          ![Rendered Elef slide](https://example.com/elef-rendered-slide.png)

          Look for overflow, contrast, unexpected wrapping, and content that
          was accidentally interpreted as markup.
          ---
          # 6. Test the important path

          The browser flow should answer:

          1. Can a person create a deck?
          2. Can they save and reopen it?
          3. Does presentation mode navigate correctly?
          4. Does a failed save preserve their source?
          ---
          # 7. Present the decision

          Presentation mode removes editor chrome and keeps attention on the
          rendered deck. Keyboard navigation makes the common path fast.
          ---
          # 8. Learn from the result

          A seed library makes these checks repeatable. When a renderer changes,
          representative decks reveal whether the change improves or regresses
          real content.
          ---
          # The workflow is a loop

          Draft, save, render, review, present, and improve. Keeping Markdown
          canonical means each iteration remains understandable and portable.
          ---
          # The outcome

          Elef is easiest to trust when the source, the preview, and the browser
          test all tell the same story.
        MARKDOWN
      },
      {
        id: "renderer-stress-test",
        title: "Sample: Renderer stress test",
        purpose: "Prove dense combinations of text, code, math, tables, media, links, and boundaries.",
        source: <<~MARKDOWN
          ---
          #{MARKER_KEY}: renderer-stress-test
          theme: match
          ---
          # Renderer stress test

          This deliberate kitchen-sink deck combines the Markdown, layout, code,
          math, table, link, image, and boundary patterns most likely to expose
          regressions.
          ---
          # One slide, many contracts

          **Text** introduces the idea, `code` names the implementation, and
          [links](https://example.com/contracts) point to more context.

          $$E = mc^2$$
          ---
          # Lists and a table

          - source remains editable;
          - preview reflects saved source;
          - presentation mode removes distractions.

          | Layer | Responsibility |
          | --- | --- |
          | Model | Persist raw Markdown |
          | Parser | Derive slides |
          | Renderer | Produce HTML |
          ---
          # Code with literal math

          ```ruby
          formula = "$x^2$"
          puts "The source is \#{formula}"
          ```

          The renderer must preserve the literal code string while rendering
          math outside the fence.
          ---
          # Fractions and superscripts

          $$\\frac{1}{3} + x^2 + y_1$$

          Fractions, superscripts, and subscripts need the complete KaTeX
          stylesheet and matching fonts to occupy the correct geometry.
          ---
          # Limits and integrals

          $$\\int_0^1 x^2\\,dx = \\frac{1}{3}$$

          $$\\lim_{n\\to\\infty} \\frac{1}{n} = 0$$

          Display equations should remain readable in preview and presentation.
          ---
          # Images and links

          ![Stress-test diagram](https://example.com/stress-test-diagram.png)

          The [rendering guide](https://example.com/rendering-guide) gives the
          audience a destination after the presentation.
          ---
          # A fenced configuration

          ```yaml
          ---
          theme: match
          layout: body
          features:
            - tables
            - math
          ```

          The delimiter-shaped line is data because it is inside a fence.
          ---
          # Long-form explanation

          A browser regression rarely announces itself as a single isolated
          feature failure. It appears when real content combines width,
          typography, whitespace, generated markup, and navigation. This slide
          intentionally supplies enough prose to exercise those interactions.
          ---
          # Review checklist

          - Is the title visible at normal presentation scale?
          - Does the table fit without clipping?
          - Are code and math visually distinct?
          - Can the audience follow the narrative?
          - Does the source reopen unchanged?
          ---
          # Stress-test conclusion

          The best fixture is not the smallest fixture. It is a deterministic
          document that resembles the work Elef is expected to present and
          fails clearly when a contract changes.
        MARKDOWN
      }
    ].freeze

    def load!
      Presentation.transaction do
        SAMPLES.map do |sample|
          presentation = Presentation.joins(:presentation_detail).find_by(presentation_details: { sample_id: sample[:id] }) ||
            find_legacy_owned(sample[:id]) || Presentation.new
          presentation.assign_attributes(
            sample_id: sample[:id],
            title: sample[:title],
            source: sample[:source]
          )
          presentation.save!
          presentation
        end
      end
    end

    def find_legacy_owned(id)
      marker = "#{MARKER_KEY}: #{id}"
      Presentation.where("source LIKE ?", "%#{Presentation.sanitize_sql_like(marker)}%").find do |presentation|
        front_matter_lines(presentation.source).any? { |line| line.strip == marker }
      end
    end
    private_class_method :find_legacy_owned

    def front_matter_lines(source)
      lines = source.to_s.lines
      return [] unless lines.first&.strip == "---"

      closing_index = lines.drop(1).find_index { |line| line.strip == "---" }
      closing_index ? lines[1..closing_index] : []
    end
    private_class_method :front_matter_lines
  end
end
