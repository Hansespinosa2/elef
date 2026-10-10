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
          theme: light
          typography: modern
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
        id: "document-design-principles",
        title: "Fixture: Elef design principles",
        purpose: "Express ten principles for a keyboard-first, welcoming, transparent authoring experience.",
        source: <<~MARKDOWN
          ---
          theme: match
          typography: book
          ---
          # Fixture: Elef design principles

          These principles describe how creating and presenting with Elef should
          feel: direct, welcoming, discoverable, and faithful to the author's intent.

          ## 1. A movement made is a moment wasted

          Optimize aggressively for the keyboard, and make every keystroke earn its
          place. Frequent actions should be close at hand, while shortcuts should
          remove friction instead of adding ceremony. The mouse remains welcome, but
          the fastest path should let focused authors keep their attention on the work.

          ## 2. A beautifully tall ceiling

          Let people grow from first draft to confident mastery without outgrowing
          Elef. Deeper controls and useful key bindings should make real tasks faster
          as soon as they are learned, and mastery should feel joyful: the author is
          capable, in command, and delighted by what the tool makes possible.

          ## 3. A gently rising floor

          Make the first useful step obvious, then teach through use rather than
          homework. Buttons can pair a clear label or icon with their key binding, so
          clicking gets the job done and quietly teaches a faster path for next time.
          New capabilities should appear when they are relevant, with room to explore.

          ## 4. Welcome in

          Meet people where they already work. Markdown, LaTeX, PowerPoint, Word,
          Google Docs, and Obsidian experts should feel at home, while newcomers should
          feel just as able to begin. Keep familiar strengths close and make the
          experience feel immediately freeing, whatever the author's starting point.

          ## 5. You see is what you get

          Keep the relationship between source, preview, saving, and export easy to
          understand. Familiar actions should behave predictably, with visible state
          when work is being saved or recovered. An author can download a tidy folder,
          inspect it, and understand the work without needing Elef to explain it.

          ## 6. Idea to keyboard

          Keep the author's attention on the idea, not on operating the editor. As
          fluency grows, typing and arranging should feel direct enough that the tool
          fades into the act of thinking and making. Every interaction should help
          intent reach the page with less translation.

          ## 7. Keyboard to eyes

          Let authors express meaning in semantic terms and let Elef turn it into
          deliberate visual structure: semantic input, geometric output. The author
          should be able to shape hierarchy and emphasis without manually fighting
          every coordinate, while retaining a clear path to refine the result.

          ## 8. Presentations are for you; Docs are for me

          Give each format the job its audience needs. A presentation helps a speaker
          guide attention in the room; a document helps a reader move at their own
          pace, find detail, and return to it later. Shared ideas can serve both without
          forcing both experiences to behave the same way.

          ## 9. Nothing good is lost

          Make experimentation feel safe. Show whether work is saved, keep recoverable
          drafts when trouble interrupts, and make meaningful revisions available to
          restore. People can explore more freely when a mistake does not threaten the
          work they have already made.

          ## 10. Let polish earn its place

          Every visual detail should orient, teach, reassure, or reduce effort. Keep
          the interface calm enough for ideas to lead, and make refinement serve
          comprehension rather than decoration. Delight belongs in the clarity and
          care of the whole experience.
        MARKDOWN
      },
      {
        id: "document-components",
        title: "Fixture: Rich components",
        purpose: "Prove tables, fenced code, inline and display math, and safe media in a document.",
        source: <<~MARKDOWN
          ---
          theme: match
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
        purpose: "Prove document block alignment without exposing the alignment directive.",
        source: <<~MARKDOWN
          ---
          theme: dark
          ---
          # Fixture: Positioned content

          Align directives are useful when a document needs a deliberately
          composed block while the surrounding source stays easy to read.

          :::align{top left}

          ### Left and top

          This block demonstrates the first supported alignment combination.

          :::align{middle center}

          ### Center and middle

          This block is centered within the document preview.

          :::align{bottom right}

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
          theme: match
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
          theme: match
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

          :::align{diagonal}

          This malformed alignment should produce a warning.

          :::align{left

          This incomplete directive is another malformed boundary.

          [unsafe link](javascript:alert(1))

          ![unsafe image](javascript:alert(1))

          [[Fixture: Missing document]]
        MARKDOWN
      },
      {
        id: "document-full-report",
        title: "Report: The State of Calm Authoring",
        purpose: "Prove a long-form report remains readable across ten or more pages of structured Markdown.",
        source: <<~MARKDOWN
          ---
          theme: light
          typography: modern
          ---
          # The State of Calm Authoring

          ## A field report on making ideas easier to shape, review, and revisit

          - **Prepared for:** teams who think in Markdown, diagrams, and unfinished drafts
          - **Status:** illustrative research report
          - **Reading time:** approximately twenty minutes

          > The quality of an authoring tool is measured less by how much it can
          > display than by how much thinking it leaves available to the author.

          This report examines a simple proposition: a writing environment should
          make the next useful edit obvious without taking ownership of the work.
          That proposition sounds modest, but it reaches into every layer of an
          authoring system. It affects how source is stored, how previews respond,
          how links acquire meaning, how reviewers leave evidence, and how a reader
          understands the final document.

          The report is intentionally long. It gives a continuous document enough
          material to reveal page rhythm, heading hierarchy, table behavior, line
          wrapping, code treatment, link styling, and the relationship between a
          calm reading surface and a dense source file. Nothing in the source
          depends on a special export step. It is ordinary Markdown meant to stay
          legible before and after rendering.

          ## Executive summary

          Most authoring friction is not caused by a lack of features. It comes
          from small interruptions that accumulate: a preview that jumps while a
          paragraph is being edited, a navigation tree that forgets where the
          reader came from, a review comment that cannot point to a durable piece
          of source, or a format conversion that quietly changes the meaning of a
          table. Each interruption asks the author to reconstruct context.

          A calm authoring system reduces those reconstruction costs. It keeps the
          raw source trustworthy, presents the rendered result quickly, and makes
          relationships between pieces of work visible without turning the editor
          into a dashboard. It treats documents as working instruments rather than
          disposable containers for a final export.

          The findings in this report are organized around five principles:

          1. **Source should remain the record.** A document is easier to trust when
             the Markdown that created it is available, inspectable, and portable.
          2. **Feedback should be local.** Warnings, parsing errors, and unresolved
             links should appear close to the edit that caused them.
          3. **Structure should carry meaning.** Headings, lists, tables, and links
             should communicate hierarchy without requiring decorative chrome.
          4. **Relationships should be recoverable.** A reader should be able to
             move from an idea to its context and back again without losing their
             place.
          5. **Polish should protect attention.** Animation, color, and controls
             should clarify a task rather than compete with the text.

          The practical recommendation is to build authoring surfaces around a
          reliable loop: write, preview, inspect, connect, and revise. The loop
          should work for a two-paragraph note and for a report long enough to
          require a table of contents, a methodology section, and several appendices.
          The same model should support both cases without forcing the short note
          to look like a report or the report to behave like a slide deck.

          ### At a glance

          | Dimension | Healthy signal | Failure mode to watch |
          | --- | --- | --- |
          | Source | Raw Markdown remains canonical | Export becomes the only editable copy |
          | Preview | Useful changes appear quickly | The author waits or loses cursor context |
          | Navigation | Links explain where they lead | A graph becomes decoration without direction |
          | Review | Feedback points to durable source | Comments refer to unstable pixels |
          | Accessibility | Structure works with assistive technology | Visual styling hides semantic order |
          | Operations | Recovery is ordinary and tested | A small error requires a full reset |

          ## 1. Context and research question

          The modern author often moves among several representations of the same
          idea. A rough note may begin in plain text, become a Markdown document,
          acquire a diagram, and eventually appear as a presentation or a published
          page. Every representation is useful, but every conversion can introduce
          drift. A heading may become a visual label without remaining a navigable
          heading. A table may become an image. A link may survive as blue text but
          lose the relationship that made it useful.

          This report asks what an authoring environment must preserve so that the
          idea remains coherent while it changes shape. The question is not whether
          one format is universally superior. The question is whether the system
          can make format changes explicit, reversible, and easy to inspect.

          The scope is deliberately practical. It covers individual authors, small
          teams, and repositories where documents are revised often enough that
          history matters. It does not assume a single editorial process. Some
          teams review by pull request, some by conversation, and some by reading a
          rendered draft together. A resilient tool should support these workflows
          without hiding the shared source.

          ### Working definitions

          In this report, *calm* does not mean slow, quiet, or visually minimal at
          all costs. Calm means that the interface makes state legible. The author
          can tell what is saved, what is still being previewed, what needs review,
          and what will happen if they continue typing.

          *Authoring* includes more than entering characters. It includes choosing a
          structure, checking an argument, maintaining links, responding to errors,
          and preparing a document for another person. A tool that makes typing
          pleasant but makes revision opaque is only solving the first part of the
          problem.

          *Lineage* means the visible history and relationship of an idea across
          documents, drafts, references, and presentations. Lineage is not a demand
          for a giant dependency graph. It is a promise that useful context will
          remain discoverable when the author needs it.

          ### A small observation

          In a conventional word processor, a reader sees a page and an author sees
          a page with invisible state layered on top. In a source-first environment,
          the author sees the structure directly. The design challenge is to let
          that structure remain powerful without making the reader feel as though
          they are looking at implementation details.

          This is why long documents are valuable test material. A short sample can
          confirm that a heading renders. A report can show whether headings create
          a sensible rhythm, whether links remain visible after several screens,
          and whether the reader can recover from losing their place.

          ## 2. The canonical source is a product decision

          Keeping Markdown as the canonical source is often described as a storage
          preference. It is more consequential than that. It determines what the
          system can preserve, diff, migrate, and hand to another tool. A source
          file is a compact record of intent: the order of ideas, the distinction
          between a list and a paragraph, the destination of a link, and the exact
          text that a reviewer can quote.

          A rendered document is still important. It is where many problems become
          obvious. But the rendered form should be derived rather than authoritative.
          When the two disagree, the system needs a clear answer about which one can
          be repaired and which one can be regenerated.

          ### What source-first enables

          A source-first model makes several useful behaviors ordinary:

          - A reviewer can inspect a small, meaningful diff instead of comparing two
            screenshots.
          - A document can be rendered with a new theme without rewriting content.
          - A link target can be renamed with a controlled source transformation.
          - A backup remains useful even when the application is unavailable.
          - A test can assert semantics such as a heading or table rather than only
            checking pixels.

          These benefits depend on discipline. The source must not become a dumping
          ground for renderer-specific fragments that no one can explain. Extensions
          should be narrow, documented, and safe when encountered by a simpler
          Markdown reader. A directive can be valuable, but it should not make the
          whole document unreadable outside the original application.

          ### The cost of pretending to be format-neutral

          Systems sometimes promise that an author can edit any representation and
          the others will stay synchronized. In practice, synchronization is only
          lossless when the representations share the same semantic vocabulary.
          A visual canvas can express position more freely than Markdown. A word
          processor can store layout decisions that have no direct source-level
          equivalent. The promise therefore needs boundaries.

          A better contract is explicit transformation. The system tells the author
          which parts are semantic content, which parts are presentation hints, and
          which parts may not round-trip. That honesty builds more trust than a
          seamless-looking conversion that quietly drops information.

          ### A source review checklist

          Before treating a long document as ready for review, an author should be
          able to answer yes to these questions:

          1. Can I find the source that produced this rendered section?
          2. Can I identify the heading hierarchy without relying on font size?
          3. Can I distinguish an unresolved link from an ordinary bracketed phrase?
          4. Can I copy the source into another editor without losing the argument?
          5. Can I tell which warnings are new in this draft?

          These are not abstract questions. Each one describes a moment when a
          person is trying to make a decision and needs the tool to stay out of the
          way.

          ## 3. Navigation and lineage

          Long-form work creates a navigation problem before it creates a layout
          problem. Readers need to know where they are, what surrounds the current
          section, and which references are worth opening. Authors need to know
          whether a change affects one document or a connected set of ideas.

          A document graph can help, but only if it answers a question. Showing every
          node at once is not automatically useful. The graph should make a hub,
          branch, cycle, or orphan legible and should give the reader a path back to
          the document that started the exploration.

          ### Links as durable handles

          A durable document link is a handle on an idea, not merely a route to a
          page. The visible label should tell the reader enough to decide whether
          the destination is relevant. When a destination is missing, the source
          should remain readable and the missing relationship should be visible as
          a warning rather than becoming a dead end.

          Good link behavior has four properties:

          - **Recognition:** the reader can tell it is a document relationship.
          - **Resolution:** a known target opens directly in the right context.
          - **Honesty:** a missing target is not presented as a working destination.
          - **Stability:** renaming a target updates intended references without
            changing examples, code, or quoted text.

          The last property is easy to underestimate. Documents contain examples of
          syntax, and those examples should not become live relationships merely
          because they resemble a link. A parser that understands code fences and
          inline code is protecting the author's intent, not adding complexity for
          its own sake.

          ### The graph should remain secondary

          The reading surface should be able to stand on its own. A reader should
          not have to decode a graph before they can understand a report. The graph
          is a map for moments of uncertainty: when the reader asks what led here,
          where the evidence lives, or which drafts depend on this decision.

          This suggests a visual hierarchy. The document title and current section
          should dominate. Local links should be easy to follow. The broader graph
          should be available, but quieter until the author asks for orientation.
          A map that is always shouting becomes another form of noise.

          ### Cycles, orphans, and unresolved edges

          Real knowledge does not form a perfect tree. A decision may refer to an
          earlier decision, two research notes may cite each other, and a new draft
          may have no incoming links yet. These states are useful information.

          A cycle can mean a feedback loop or a pair of mutually defining concepts.
          An orphan can mean a forgotten note, or it can mean a new idea that has
          not found its home. An unresolved edge can mean a typo, a planned draft,
          or a renamed target awaiting repair. The interface should show these
          states without treating them as catastrophic errors.

          The right question is not “How do we eliminate every unusual shape?” It is
          “How do we make each shape interpretable and actionable?” That is a better
          measure of lineage quality than visual density.

          ## 4. Preview and rendering fidelity

          A preview is a conversation between source and result. The author makes
          an edit, the renderer responds, and the author decides whether the new
          result is closer to the intended meaning. This conversation breaks down
          when the preview is slow, unstable, or too eager to erase the last useful
          result.

          The safest default is to preserve the last good preview while reporting
          what went wrong with the new draft. A malformed directive should not turn
          the entire reading surface into a blank panel. The author needs enough
          continuity to understand the error and enough detail to correct it.

          ### Fidelity has layers

          Rendering fidelity is not only a question of whether the final pixels look
          attractive. It has at least four layers:

          1. **Text fidelity:** words, punctuation, and Unicode survive unchanged.
          2. **Structural fidelity:** headings, lists, tables, and quotes retain
             their semantic relationships.
          3. **Interaction fidelity:** links, controls, and previews respond as the
             author expects.
          4. **Visual fidelity:** spacing, type, contrast, and wrapping support the
             intended reading experience.

          A document may succeed at one layer and fail at another. A table can be
          semantically correct but overflow on a phone. A link can be visually
          attractive but point to a stale target. A heading can look like a heading
          while being emitted as a generic paragraph. Testing should name the layer
          under examination.

          ### Density is a feature with a limit

          Long reports need density. The reader should not have to scroll through
          enormous empty spaces between every paragraph. At the same time, density
          without landmarks becomes a wall of text. The solution is not to make
          every paragraph a card. It is to use a small vocabulary of reliable cues:
          heading scale, paragraph measure, list indentation, table rules, code
          contrast, and predictable spacing.

          The document should feel continuous while still offering places to pause.
          A horizontal rule can mark a genuine shift in topic. A short summary can
          prepare the next section. An appendix can feel like a destination rather
          than an accidental continuation. These cues are structural, not ornamental.

          ### An example of a safe rendering contract

          ```ruby
          result = DocumentPreview.render(source)

          if result.success?
            preview.replace(result.html)
            warnings.replace(result.warnings)
          else
            warnings.replace(result.warnings)
            status.show("Preview unavailable; showing the last good result")
          end
          ```

          The important part of this example is not the API name. It is the
          contract: a successful result replaces the preview, while an unsuccessful
          result preserves useful context and explains the failure. A long report
          gives this contract enough surface area to prove that it works beyond a
          single heading.

          ## 5. Review and collaboration

          Review is where an authoring system meets another person. The reviewer may
          not share the author's mental model, and the author may not be present to
          explain a choice. The source and rendered result must therefore provide
          enough evidence for a conversation to be precise.

          A good review experience makes it easy to answer three questions:

          - What changed?
          - Why did it change?
          - What should happen next?

          A diff is strongest when it follows the source's structure. Replacing a
          sentence should not reformat every following paragraph. Renaming a target
          should reveal the relationship change without obscuring unrelated prose.
          This is one reason to prefer stable Markdown over opaque serialized layout.

          ### Review the argument, not only the surface

          Visual review catches clipping, awkward breaks, and hierarchy problems.
          Source review catches accidental deletions, broken links, and changes in
          meaning. Neither replaces the other. A long report needs a deliberate
          handoff between them.

          One useful pattern is to begin with the rendered document, record questions
          in the language of sections and paragraphs, then inspect the source only
          where a question requires precision. This keeps the first read natural.
          The author can then respond with a source-level change that remains easy to
          audit later.

          ### Comments need an anchor

          A comment such as “this feels too strong” is valuable only if the team can
          find the sentence again after the document changes. Anchors can be line
          ranges, stable headings, or generated identifiers. They do not need to be
          ugly in the reading surface, but they do need to survive ordinary edits.

          The most useful anchor is often a combination of heading and nearby text.
          A reviewer can say, “In the paragraph under ‘Density is a feature with a
          limit,’ explain why the proposed spacing is preferable on small screens.”
          That language remains meaningful even if line numbers shift.

          ### The social shape of a calm tool

          Tools influence review culture. If feedback is difficult to place, people
          wait until a meeting. If the rendered draft is easy to share but impossible
          to diff, the team approves changes by impression. If warnings are hidden,
          reviewers learn not to look for them.

          A calm tool makes the healthy behavior the easy behavior: read the draft,
          follow a reference, inspect the source behind a passage, and leave a small
          actionable note. It does not promise to remove disagreement. It makes
          disagreement more specific.

          ## 6. Accessibility and the reading experience

          Accessibility is not a final coat of contrast paint. It is the discipline
          of preserving meaning across different ways of reading, navigating, and
          interacting. A long report is a useful test because it contains enough
          structure to reveal whether the hierarchy is real.

          Headings should form an outline that makes sense when read without visual
          styling. Lists should remain lists. Tables should expose their headers to
          assistive technology. Links should have names that distinguish their
          destinations. A warning should be announced without forcing a user to
          search a decorative region.

          ### Reading order is a design constraint

          A visual layout can place a callout beside a paragraph, but the source and
          accessibility tree still need a coherent order. If an important qualifier
          is visually separated from the statement it qualifies, a screen reader or
          keyboard user may encounter a different argument than a mouse user.

          This does not mean every layout must be plain. It means the visual layer
          should be a faithful arrangement of a semantic sequence. Positioning hints
          can help with emphasis, but they should not be the only way to discover
          that a piece of content exists.

          ### Small screens are not a special case

          A report that reads well on a wide screen may become a collection of traps
          on a phone: a table forces horizontal scrolling, a graph pushes the title
          off-screen, or a long heading wraps into a shape that obscures its level.
          Responsive behavior should preserve the author's ability to orient before
          asking them to zoom or pan.

          Useful mobile behavior is often intentionally simple. Tables can scroll
          within a labeled region. Long code can wrap or expose a controlled scroll
          affordance. Navigation can collapse while the current section remains
          clear. The page should not silently shrink text until it becomes tiring.

          ### Contrast and restraint

          Color can distinguish states, but it should not be the only signal. A
          warning needs text and an icon or label. A selected graph node needs more
          than a subtle hue shift. A muted paragraph should still be readable when
          the display is dim or the user has changed contrast preferences.

          Restraint matters here because every extra visual signal competes with the
          report. Strong color belongs to important state changes. Ordinary prose
          deserves the quiet background that lets it remain prose.

          ## 7. Performance, resilience, and recovery

          Performance is part of the writing experience because waiting changes how
          people edit. A delay after every keystroke encourages shorter thoughts,
          fewer experiments, and more reliance on external scratch space. A delay
          while opening a long report makes the author question whether the document
          is safe to revisit.

          The goal is not to promise that every operation is instant. The goal is to
          make the cost predictable and to keep the interface useful while work is in
          progress. A preview can show its current state. A save can show whether it
          succeeded. A graph can render a partial result if the full analysis takes
          longer than expected.

          ### Failure should be recoverable

          A resilient authoring system assumes that inputs will be incomplete. A
          document can contain an unmatched fence, a malformed directive, a missing
          link, or a very long line. These conditions should produce local feedback.
          They should not erase unrelated content or make the document impossible
          to open.

          Recovery also applies to application state. If a browser reloads during an
          edit, the user should know whether the last change was saved. If a preview
          request returns late, it should not overwrite a newer draft. If a sample
          loader runs twice, it should update managed samples without duplicating
          them or replacing a personal document with the same title.

          ### A simple performance budget

          A team can make the experience concrete by naming budgets. For example:

          | Operation | Target | User-visible fallback |
          | --- | ---: | --- |
          | Open a saved document | 500 ms | Show title and source shell |
          | Preview a normal edit | 250 ms | Keep the last good preview |
          | Save a document | 500 ms | Keep draft state and retry |
          | Build a document graph | 1 s | Show the list while the map loads |
          | Render a long report | 2 s | Show progressive status |

          These numbers are starting points, not promises. Their value is that they
          turn “it feels slow” into a question the team can investigate. A report
          with tables, code, links, and many headings is a better benchmark than an
          empty document because it represents the work people actually do.

          ### Recovery is part of trust

          Users trust a system that makes failure boring. A warning that explains
          what happened, preserves the last good state, and offers a clear next step
          is less damaging than a polished interface that silently loses context.
          Reliability is experienced through these small moments more than through a
          status page that says everything is healthy.

          ## 8. An operating model for teams

          An authoring tool cannot solve process problems by itself, but it can make
          a good process visible. Teams need a shared vocabulary for drafts, review,
          decisions, and publication. They need to know where a source lives and
          which rendered view should be treated as current.

          A lightweight operating model has four stages:

          1. **Shape:** capture the idea in a source-first draft without prematurely
             optimizing the layout.
          2. **Connect:** add links, evidence, and references so the draft has a
             visible relationship to surrounding work.
          3. **Review:** read the rendered result, inspect the source diff, and
             resolve warnings before publication.
          4. **Reuse:** turn stable sections into future starting points without
             confusing a template with a finished argument.

          The stages are not a waterfall. Authors move back and forth between them.
          The value is that each stage names a different kind of attention. A person
          shaping an argument should not have to solve every typography question at
          the same time. A person reviewing a final draft should not have to reverse
          engineer where its evidence came from.

          ### Templates versus fixtures

          A template is an invitation to begin. A fixture is a reliable piece of
          sample content used to exercise a system. The distinction is important.
          Templates should be easy to adapt and should avoid implying that their
          wording is authoritative. Fixtures should be stable enough that tests and
          demonstrations can refer to them by name.

          A long report fixture serves both purposes when it is written carefully.
          It gives a new author a substantial document to explore, and it gives the
          product a repeatable stress case. It should be clearly labeled as sample
          material so no one mistakes its invented recommendations for organizational
          policy.

          ### Ownership and maintenance

          Sample content has a maintenance cost. When the renderer changes, the
          fixture may reveal a real regression or may simply expose an intentionally
          unusual boundary. The purpose field beside each sample is therefore part
          of the catalog's contract. It explains why the content exists and helps a
          maintainer decide whether a failing assertion is a bug or an outdated
          expectation.

          The long report should be kept readable by a human. If it becomes a pile
          of repeated filler paragraphs, it will stop serving as a useful authoring
          example. Length is necessary for page rhythm, but meaning is what makes
          the rhythm worth inspecting.

          ## 9. Measuring whether the experience is working

          “It feels good” is a meaningful product judgment, but it becomes more
          useful when paired with observable evidence. The measurement should not
          reduce writing to a race. It should help the team notice where the tool is
          adding cognitive load.

          A balanced evaluation includes four kinds of evidence:

          - **Structural checks:** headings, links, lists, tables, and warnings are
            represented semantically.
          - **Behavioral checks:** saves, previews, navigation, and recovery work in
            the workflows authors actually use.
          - **Visual checks:** spacing, contrast, wrapping, and responsive behavior
            remain legible at representative sizes.
          - **Experiential checks:** people can explain what happened and what to do
            next without a tutorial beside them.

          ### A small scorecard

          | Question | Evidence | Healthy result |
          | --- | --- | --- |
          | Can a reader orient quickly? | Find title, outline, and current section | The document has visible landmarks |
          | Can an author recover from an error? | Submit malformed preview input | Last good result remains available |
          | Can a reviewer follow context? | Open a linked reference and return | The source relationship stays clear |
          | Can a phone reader continue? | Inspect a 390–600 px viewport | No accidental page-wide overflow |
          | Can the team trust the sample? | Reload the catalog twice | No duplicate or destructive writes |

          The scorecard is intentionally small. A team that measures everything may
          collect numbers without learning anything. The best checks are close to a
          real decision: continue reading, fix the warning, approve the change, or
          return to the previous document.

          ### Qualitative prompts

          After using a long document, ask the author:

          1. Where did you expect the interface to help and it did not?
          2. When did you feel uncertain about what was saved or rendered?
          3. Which part of the document was easiest to revisit?
          4. Did any control compete with the text you were trying to understand?
          5. If you had to teach one part of the workflow to a teammate, what would
             you explain first?

          The answers often expose friction that automated tests cannot. A test can
          prove that a button exists. A person can tell us whether they understood
          why it was there and what would happen after clicking it.

          ### The value of a long fixture

          A ten-page fixture creates repeated opportunities for these questions. The
          reader encounters the same heading scale at different depths, follows a
          link after several screens, reaches a table after a dense paragraph, and
          returns from an appendix to the main argument. If the experience is only
          pleasant at the top of the document, the fixture makes that visible.

          Long content also exposes state problems. A preview may appear correct at
          the beginning and lose its rhythm after a later update. A graph may look
          balanced with five nodes and cramped with fifteen. A mobile layout may
          pass with short titles and fail when a report heading wraps. These are not
          artificial concerns; they are ordinary consequences of real documents.

          ## 10. Recommendations

          The following recommendations are deliberately practical. They describe
          the smallest system behaviors that preserve calm as a document grows.

          ### Keep the source visible and portable

          Make it easy to inspect raw Markdown, copy it, and understand which parts
          are ordinary syntax versus application extensions. Treat export as a
          derived representation. When a feature cannot round-trip cleanly, state
          the boundary in the source and in the documentation.

          ### Make warnings precise and local

          Put warnings near the preview or source region they describe. Preserve
          the last good result when the new draft cannot render. Use language that
          says what was recognized, what was ignored, and what the author can try
          next. “Something went wrong” is a status report, not a useful warning.

          ### Give relationships a readable home

          Keep document links visible in the source and useful in the rendered
          result. Offer a graph or related-document view for orientation, but do not
          make the map a prerequisite for reading. Show unresolved relationships as
          honest, recoverable states.

          ### Test the whole loop

          Pair parser and renderer tests with request tests and headless workflow
          tests. Assert both the happy path and the recovery path. A long report
          should appear in the sample catalog and should be exercised at wide and
          narrow widths, because the page is part of the product behavior.

          ### Treat polish as clarity

          Polish should answer a question: where am I, what changed, what can I do
          next, or what deserves attention? If a visual treatment does not answer
          one of those questions, it should be quiet enough not to compete with the
          argument. The calmest interface is not the one with the fewest controls;
          it is the one whose controls are easy to interpret.

          ### Build for return visits

          Authors rarely read a report only once. They return to a section after a
          meeting, open a source link after a week, or revive an old draft when new
          evidence arrives. Preserve stable titles, useful headings, durable links,
          and predictable scroll behavior. A document that is pleasant only on its
          first reading is not finished.

          ## Conclusion

          Calm authoring is a systems property. It emerges when storage, parsing,
          rendering, navigation, review, and visual design agree on what the author
          is trying to do. No single animation or editor shortcut can create that
          agreement. It is built through small, testable contracts that preserve
          meaning and make state visible.

          A long-form report is a useful proving ground because it refuses to hide
          behind a polished first screen. It asks whether headings still orient,
          whether tables still fit, whether warnings remain understandable, whether
          links still lead somewhere meaningful, and whether the author can keep
          thinking while the system responds.

          The best result is not a document that looks finished from a distance. It
          is a document that invites the next useful edit, gives the next reader a
          clear path, and remains trustworthy when the work changes shape.

          ---

          ## Appendix A: Scenario matrix

          The matrix below turns the report's principles into repeatable exercises.
          Each scenario can be performed with the source, the rendered preview, or
          both. The goal is not to produce a perfect score. The goal is to expose
          where the author has to carry state in their head.

          | Scenario | Starting state | Action | Evidence to collect |
          | --- | --- | --- | --- |
          | New report | Empty document | Add a title and three sections | Heading outline and save state |
          | Dense section | Several paragraphs and a table | Edit a sentence in the middle | Cursor stability and preview latency |
          | Broken syntax | Unclosed fence | Request a preview | Warning text and last good result |
          | Missing relationship | Link to an unknown title | Open the document | Honest unresolved-link treatment |
          | Returning reader | Report opened yesterday | Follow a reference and go back | Orientation and scroll recovery |
          | Small screen | 390 px viewport | Read the table and appendix | Overflow, wrapping, and controls |
          | Repeated seed | Existing sample catalog | Load sample documents again | Idempotence and conflict handling |

          A useful test session does not need a large panel of participants. One
          author, one reviewer, and one reader can reveal different problems because
          they bring different goals. The author cares about momentum. The reviewer
          cares about evidence. The reader cares about orientation.

          ## Appendix B: A lightweight review template

          **Purpose of this review:**

          Describe the decision or understanding this document should support.

          **What changed since the previous draft:**

          List the meaningful changes in source terms. Mention new sections, removed
          assumptions, changed links, and any known rendering limitations.

          **Questions for the reader:**

          - What is the strongest claim in this draft?
          - Where does the evidence feel incomplete?
          - Which section should be easier to revisit?
          - Did any link, table, or warning make the reading experience confusing?

          **Ready-to-publish checks:**

          - The title describes the document without relying on context.
          - The heading hierarchy is meaningful when read as an outline.
          - Links resolve or are intentionally marked as unresolved.
          - Warnings have been reviewed and do not hide content.
          - The source remains portable Markdown.
          - The rendered document has been inspected on a narrow viewport.

          A template like this should remain short enough to use. Its purpose is to
          support judgment, not to replace it with a form.

          ## Appendix C: Glossary

          **Canonical source** — The representation treated as authoritative and
          used to regenerate derived views.

          **Document graph** — A visual or structural representation of links among
          documents, including cycles, branches, and orphan nodes.

          **Last good preview** — The most recent rendered result known to be valid,
          preserved while a newer draft produces warnings or errors.

          **Lineage** — The history and relationships that let a reader understand
          where an idea came from and where it is used.

          **Sample fixture** — Stable content included to demonstrate behavior,
          exercise rendering, and give authors a realistic place to explore.

          **Semantic structure** — Meaning carried by headings, lists, tables, links,
          and other elements independently of their visual styling.

          **Source-first workflow** — A workflow in which the editable source remains
          inspectable and portable while previews and exports are derived from it.

          **Warning** — Local feedback that explains a condition the author should
          understand without discarding otherwise useful content.
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
