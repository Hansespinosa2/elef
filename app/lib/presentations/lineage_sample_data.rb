module Presentations
  module LineageSampleData
    module_function

    SAMPLES = [
      {
        id: "lineage-root",
        title: "Quarterly Review May",
        purpose: "Root deck: establish a baseline with margins, evidence, a footer, and a centered decision.",
        source: <<~MARKDOWN
          ---
          theme: light
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Quarterly review}
          :::subsection{Baseline}
          # Quarterly Review May

          The baseline for the quarterly review: what changed, what matters,
          and which decision the next revision must carry forward.
          :::footnote{Source: May operating review}
          ---
          # What changed

          - Retention improved after the onboarding revision.
          - Support volume fell while activation stayed steady.
          - The next risk is scaling the successful path.

          | Signal | May | Direction |
          | --- | ---: | --- |
          | Activation | 68% | Up |
          | Retention | 74% | Stable |
          | Support volume | 112 | Down |
          ---
          # Decision to carry forward

          :::position{center middle}

          Keep the onboarding change, measure its cost, and revisit the decision
          after the next reporting cycle.
          ---
          # Close the baseline

          The next deck should preserve the evidence, make the trade-offs
          explicit, and show whether the improvement survives a larger audience.
        MARKDOWN
      },
      {
        id: "lineage-continuation-june",
        title: "Quarterly Review June",
        parent: "lineage-root",
        fork_type: "continuation",
        purpose: "Continuation deck: preserve the review arc while updating evidence and the next decision.",
        source: <<~MARKDOWN
          ---
          theme: light
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Quarterly review}
          :::subsection{Continuation}
          # Quarterly Review June

          June continues the May review with one more month of evidence and a
          sharper question about operating cost.
          :::footnote{Source: June operating review}
          ---
          # The signal held

          Activation reached 71% and retention remained above the baseline.
          The continuation keeps the original decision visible while adding
          the information that was not available in May.

          | Signal | May | June |
          | --- | ---: | ---: |
          | Activation | 68% | 71% |
          | Retention | 74% | 75% |
          | Support volume | 112 | 108 |
          ---
          # The new constraint

          The onboarding change is working, but review time is growing with
          every new team. The next iteration needs a repeatable explanation.
          ---
          # June decision

          Continue the experiment, document the operating cost, and return with
          a recommendation that can be reused by the next team.
        MARKDOWN
      },
      {
        id: "lineage-inspiration-workshop",
        title: "Workshop Ideas",
        parent: "lineage-root",
        fork_type: "inspiration",
        purpose: "Inspiration deck: deliberately reframe the review as a workshop rather than a continuation.",
        source: <<~MARKDOWN
          ---
          theme: dark
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Workshop}
          :::subsection{Reframe}
          # Workshop Ideas

          This inspiration branch turns the quarterly review into a room for
          generating better questions, not a status update.
          :::footnote{A related interpretation, not a replacement review}
          ---
          # Reframe the review

          ## Audience

          The people who operate the workflow every day.

          ## Constraint

          The successful path is not yet easy to explain.

          ## Opportunity

          Make the reasoning reusable before making the process larger.
          ---
          # Put the question in the room

          :::position{center middle}

          What would we change if the next team had to learn this without us?
          ---
          # Workshop output

          Capture the language, evidence, and unresolved questions that a
          continuation deck can turn into a concrete operating decision.
        MARKDOWN
      },
      {
        id: "lineage-continuation-july",
        title: "Quarterly Review July",
        parent: "lineage-continuation-june",
        fork_type: "continuation",
        purpose: "Second continuation: show a deeper branch with a durable metric and an explicit handoff.",
        source: <<~MARKDOWN
          ---
          theme: match
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Quarterly review}
          :::subsection{Handoff}
          # Quarterly Review July

          July turns the June continuation into a handoff another team can
          inspect and continue without recovering the original context.
          :::footnote{Source: July operating review}
          ---
          # The metric is durable

          Retention held at 76% while the onboarding change reached more teams.
          The important result is now a repeatable pattern rather than a single
          successful month.
          ---
          # The handoff contract

          - Keep the onboarding change.
          - Track review time beside customer outcomes.
          - Reuse the decision language in the next review.
          ---
          # July decision

          The next continuation owns the operating cost. The lineage records
          why this deck follows June instead of presenting a disconnected copy.
        MARKDOWN
      },
      {
        id: "lineage-inspiration-retrospective",
        title: "Retrospective Notes",
        parent: "lineage-inspiration-workshop",
        fork_type: "inspiration",
        purpose: "Second inspiration branch: preserve workshop learning while changing the output into practice notes.",
        source: <<~MARKDOWN
          ---
          theme: dark
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Workshop}
          :::subsection{Retrospective}
          # Retrospective Notes

          The workshop produced language and questions. These notes turn them
          into practices without pretending to be the next quarterly review.
          :::footnote{An independent branch from the workshop}
          ---
          # What surprised us

          People did not need more dashboards. They needed a shared explanation
          of which signal changed the decision.
          ---
          # Practice to keep

          Start every review with the decision, then show only the evidence that
          can change it.
          ---
          # A useful prompt

          Ask what a new team would misunderstand if the source disappeared.
          The answer becomes the next workshop input.
        MARKDOWN
      },
      {
        id: "lineage-product-root",
        title: "Product Launch Plan",
        purpose: "Root deck: establish a launch narrative with a table, evidence, and a clear audience promise.",
        source: <<~MARKDOWN
          ---
          theme: light
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Product launch}
          :::subsection{Plan}
          # Product Launch Plan

          The launch plan aligns the audience, promise, evidence, and decision
          needed before the product reaches more customers.
          :::footnote{Source: launch planning brief}
          ---
          # The promise

          Make a complex workflow understandable without adding another tool
          that the team must learn.
          ---
          # Evidence and risk

          | Claim | Evidence | Risk |
          | --- | --- | --- |
          | Faster onboarding | Pilot completion time | Narrow pilot |
          | Clearer review | Fewer clarification cycles | New vocabulary |
          ---
          # Launch decision

          Launch to the pilot audience with a clear explanation of what changed
          and a measurement plan for what happens next.
        MARKDOWN
      },
      {
        id: "lineage-product-continuation",
        title: "Launch Narrative",
        parent: "lineage-product-root",
        fork_type: "continuation",
        purpose: "Continuation deck: turn the launch plan into a sequence that can be presented to the next audience.",
        source: <<~MARKDOWN
          ---
          theme: match
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Product launch}
          :::subsection{Narrative}
          # Launch Narrative

          The plan becomes a narrative: orient the audience, name the tension,
          show the proof, and make the next action easy.
          :::footnote{Continuation of the launch plan}
          ---
          # Orient the audience

          Begin with the workflow they already know, then show the point where
          the current process makes the decision expensive.
          ---
          # Show the proof

          Use one before-and-after example, one measured result, and one honest
          limit. The narrative should earn the final recommendation.
          ---
          # Next action

          Invite the audience to run the pilot with the same measurement plan.
          This is the continuation of the plan, not a second unrelated pitch.
        MARKDOWN
      },
      {
        id: "lineage-product-inspiration",
        title: "Customer Story",
        parent: "lineage-product-root",
        fork_type: "inspiration",
        purpose: "Inspiration deck: reinterpret the launch plan through one customer story and a centered outcome.",
        source: <<~MARKDOWN
          ---
          theme: dark
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Product launch}
          :::subsection{Customer story}
          # Customer Story

          This branch uses the launch plan as source material for a customer
          story rather than extending the product plan.
          :::footnote{An independent customer-centered interpretation}
          ---
          # Before the change

          The team had the information, but each review began by reconstructing
          the same context from scattered notes.
          ---
          # The moment of clarity

          :::position{center middle}

          The workflow became easier to trust when the source and the outcome
          told the same story.
          ---
          # What the story proves

          A single customer example can make the abstract launch promise
          concrete without claiming that every customer has the same path.
        MARKDOWN
      },
      {
        id: "lineage-product-followup",
        title: "Launch Retrospective",
        parent: "lineage-product-continuation",
        fork_type: "continuation",
        purpose: "Second continuation: inspect launch outcomes and preserve a measurable feedback loop.",
        source: <<~MARKDOWN
          ---
          theme: light
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Product launch}
          :::subsection{Retrospective}
          # Launch Retrospective

          The launch continuation now has enough evidence to compare the promise
          with the experience teams actually had.
          :::footnote{Source: post-launch review}
          ---
          # What held

          The workflow was easier to explain, and the pilot teams completed the
          first review with fewer clarification cycles.
          ---
          # What did not

          The measurement plan arrived too late for one team. The next launch
          must make instrumentation part of the starting contract.
          ---
          # Feed the next plan

          Carry the result back to the launch narrative with one changed
          assumption and one new measure.
        MARKDOWN
      },
      {
        id: "lineage-product-brief",
        title: "Briefing Notes",
        parent: "lineage-product-inspiration",
        fork_type: "inspiration",
        purpose: "Second inspiration branch: compress the customer story into a briefing with a different audience and goal.",
        source: <<~MARKDOWN
          ---
          theme: match
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Product launch}
          :::subsection{Briefing}
          # Briefing Notes

          These notes extract the customer story's implication for a leadership
          audience without turning it into a continuation of the product plan.
          :::footnote{An independent briefing derived from the customer story}
          ---
          # The decision in one line

          Fund the measurement work that makes the successful workflow repeatable.
          ---
          # The trade-off

          | Invest in | Gain | Give up |
          | --- | --- | --- |
          | Measurement | Confidence | Short-term speed |
          | More features | Reach | Explanatory clarity |
          ---
          # Briefing close

          The customer story is evidence. The investment decision is the new
          work this briefing asks the audience to make.
        MARKDOWN
      },
      {
        id: "lineage-research-root",
        title: "Research Questions",
        purpose: "Root deck: frame a research program with questions, hypotheses, and a bounded next step.",
        source: <<~MARKDOWN
          ---
          theme: light
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Research}
          :::subsection{Questions}
          # Research Questions

          The research begins by making uncertainty explicit instead of
          pretending that the first plausible explanation is the answer.
          :::footnote{Source: research planning session}
          ---
          # The questions

          - Which part of the workflow creates the most avoidable delay?
          - Which signal would change the product decision?
          - What evidence can we gather without changing the behavior?
          ---
          # A bounded hypothesis

          If review time grows with complexity, then the cost should scale with
          the number of decisions, not simply with the number of documents.
          ---
          # Research next step

          Observe the next review, record the decision points, and return with
          findings that can support either a continuation or a new direction.
        MARKDOWN
      },
      {
        id: "lineage-research-continuation",
        title: "Research Findings",
        parent: "lineage-research-root",
        fork_type: "continuation",
        purpose: "Continuation deck: turn research questions into evidence, a small model, and a decision.",
        source: <<~MARKDOWN
          ---
          theme: match
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Research}
          :::subsection{Findings}
          # Research Findings

          The observation supports the original question: review time grows
          when the source of a decision is difficult to recover.
          :::footnote{Source: observed review sessions}
          ---
          # The observed pattern

          Teams spent less time reading the evidence than searching for where
          the evidence came from.
          ---
          # A small model

          ~~~ruby
          review_cost = decision_count * context_recovery_time
          puts review_cost
          ~~~

          The model is useful because it makes the hidden variable discussable.
          ---
          # Finding to carry forward

          Preserve the source relationship as part of the authoring workflow,
          then test whether future reviews become easier to explain.
        MARKDOWN
      },
      {
        id: "lineage-research-inspiration",
        title: "Workshop Prompts",
        parent: "lineage-research-root",
        fork_type: "inspiration",
        purpose: "Inspiration deck: turn research questions into prompts for a workshop rather than findings.",
        source: <<~MARKDOWN
          ---
          theme: dark
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Research}
          :::subsection{Workshop}
          # Workshop Prompts

          The research questions become prompts that help a group surface
          assumptions before anyone claims to have findings.
          :::footnote{An independent workshop interpretation}
          ---
          # Three doors into the problem

          ## Recover

          Where did the decision come from?

          ## Compare

          Which alternative did we reject?

          ## Continue

          What would the next person need to know?
          ---
          # Put the hardest question first

          :::position{center middle}

          What evidence would make us change our mind?
          ---
          # Workshop output

          Capture prompts, not conclusions. The next continuation can decide
          which prompts deserve measurement.
        MARKDOWN
      },
      {
        id: "lineage-research-next",
        title: "Decision Memo",
        parent: "lineage-research-continuation",
        fork_type: "continuation",
        purpose: "Second continuation: convert findings into a decision memo with an explicit recommendation and footnote.",
        source: <<~MARKDOWN
          ---
          theme: light
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Research}
          :::subsection{Decision}
          # Decision Memo

          The findings are now specific enough to support a bounded product
          decision rather than another round of open-ended research.
          :::footnote{Decision based on the research findings}
          ---
          # Recommendation

          Preserve source relationships in the authoring workflow and measure
          context recovery time in the next review cycle.
          ---
          # What this does not claim

          The finding does not prove that every review has the same cost. It
          gives the next experiment a clear measure and a clear boundary.
          ---
          # Decision

          Run the experiment with two teams, compare the recovery time, and
          return with evidence strong enough to continue or stop.
        MARKDOWN
      },
      {
        id: "lineage-research-remix",
        title: "Talk Outline",
        parent: "lineage-research-inspiration",
        fork_type: "inspiration",
        purpose: "Second inspiration branch: remix workshop prompts into a talk outline with a different narrative arc.",
        source: <<~MARKDOWN
          ---
          theme: match
          show-in-margin:
            section: true
            subsection: true
            footnote: true
            slideCount: true
          ---
          :::section{Research}
          :::subsection{Talk}
          # Talk Outline

          This remix takes the workshop's open questions and turns them into a
          talk about how teams recover the reasoning behind a decision.
          :::footnote{An independent talk outline from the workshop prompts}
          ---
          # Opening story

          Begin with a decision everyone remembers and ask whether anyone can
          still explain why it was made.
          ---
          # The argument

          Source, evidence, and outcome form a chain. When one link disappears,
          the team spends time rebuilding context instead of making progress.
          ---
          # Closing invitation

          Leave the audience with one practical question: what should the next
          person be able to recover without asking us?
        MARKDOWN
      }
    ].each_with_index.map do |sample, index|
      day_offsets = [0, 7, 7, 14, 14, 0, 7, 7, 14, 14, 0, 7, 7, 14, 14]
      sample.merge(created_at: Time.utc(2026, 1, 1) + day_offsets[index].days + index.minutes)
    end.freeze

    def load!
      Presentation.transaction do
        records = {}

        SAMPLES.each do |attributes|
          record = Presentation.joins(:presentation_detail).find_by(presentation_details: { sample_id: attributes[:id] }) || Presentation.new
          record.assign_attributes(
            sample_id: attributes[:id],
            title: attributes[:title],
            source: attributes[:source],
            created_at: attributes[:created_at]
          )
          records[attributes[:id]] = record
        end

        SAMPLES.each do |attributes|
          record = records.fetch(attributes[:id])
          parent = records[attributes[:parent]]
          record.parent = parent
          record.fork_type = attributes[:fork_type] if attributes[:fork_type]
          record.save!
          if parent
            edge = PresentationLineageEdge.find_or_initialize_by(child_work: record)
            edge.assign_attributes(
              parent_work: parent,
              origin_revision: parent.latest_checkpoint,
              fork_type: attributes[:fork_type],
              parent_title_snapshot: parent.title,
              origin_source_snapshot: parent.source
            )
            edge.save!
          else
            PresentationLineageEdge.where(child_work: record).delete_all
          end
        end

        records.values
      end
    end
  end
end
