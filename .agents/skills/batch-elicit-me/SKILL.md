---
name: batch-elicit-me
description: Interview the user in batches of concrete, self-contained questions until their preferences on a topic are complete, stable, and conflict-free, then deliver a reusable preference list. Use when the user explicitly invokes it or asks to be interviewed about what they want before a decision, design, or plan.
disable-model-invocation: true
---

# Batch Elicit Me

Build a complete, stable picture of what the user wants through successive batches of questions, then deliver it as a preference list. Batches let a busy user answer once and let you see how their answers interact. This skill only elicits: do not implement, change files, or act on the preferences, and stop after delivery.

## Definitions

- **Preference:** something the user wants or wants to avoid, what wins when wants collide, and why.
- **Constraint:** a boundary the user treats as non-negotiable. Test it: if they would drop it at a high enough price, it is a preference in disguise. Reclassify it.
- **Conflict:** two preferences, or a preference and a constraint, pulling in different directions.
- **Stable:** survives its real costs and competing preferences, and is consistent with related answers. An untested preference is a draft.
- **Complete:** (a) the user had enough plain, concrete information to genuinely decide, and (b) the record can be reused without re-asking: what, scope, reason, accepted trade-offs, and how it beats competing wants. A pick made without enough information is a guess, not a finding.
- **Ripe question:** its prerequisite decisions are settled, the user can judge it, no investigation could answer it instead, and its answer would materially sharpen the picture.

## Loop

1. **Frame.** Identify the topic, the decisions the preferences will inform, and qualities worth preserving (things the user praised, chose before, or treated as non-negotiable). If the topic itself is unclear, make it the first batch.
2. **Track a private inventory.** Per candidate preference: what, reason, scope, stakes, status (open, qualified, stable, contradicted, deferred), whether the user was informed enough to decide, accepted trade-offs, conflicts, evidence still needed. Prioritize by impact, uncertainty, and cost to reverse later.
3. **Investigate before asking.** Facts are yours to find in the conversation, files, and environment. Ask only about wants, trade-offs only the user can weigh, and tensions between wants. For low-impact, reversible details, state a default instead of asking. Settle the underlying preference before asking about fine parameters.
4. **Send a batch** of every ripe, material question.
5. **Read the answers as a whole,** update the inventory, and send the next batch: follow-ups, newly ripe probes, carried-forward questions.
6. **Finish** when every material preference is stable and complete, conflicts are resolved, and constraints are recorded: confirm once, then deliver.

Do not stop after one batch, a partial list, an acknowledgment, or an offer to continue while the picture is incomplete or unstable. Be relentless but not repetitive: each batch must earn its questions. If the user asks to stop or wrap up, deliver now and mark unfinished items as draft or deferred, not stable.

## Writing a batch

Send batches as a normal message, not through an option-picker tool, which cannot carry the explanation each question needs. Assume the user is multitasking and sees only this message.

**Size:** 3-7 questions, numbered Q1, Q2... and restarting each batch. Send fewer when few are ripe, more only when questions are short and independent. If more than seven are ripe, send the highest-impact and carry the rest. Never pad.

**Include:** open preferences needing a first statement; vague ones needing precision (scope, threshold, exception); stability tests; suspected conflicts; follow-ups from the last batch; carried-forward questions that still matter.

**Exclude:** unripe questions; facts you can look up; matters the user cannot yet judge (ground them first, then ask); low-impact questions with an obvious default; duplicate, dominated, or filler options.

**Dependencies:** move the downstream question to the next batch, or make it conditional ("If Q2 is A, answer Q3; otherwise skip Q3").

### Make each question answerable

Each question must contain what the user needs to form a real opinion:

- the concrete situation, in plain language, and what the answer will later decide;
- credible options, each with a genuine benefit and a genuine cost, and why each occurs;
- a provisional recommendation and its assumptions.

Define every term before it influences the answer. Name concrete consequences instead of labels like "balanced" or "simpler". If one option wins on every dimension, adopt it as a default rather than manufacturing a choice. When the real need is a threshold, ranking, or description of an unacceptable outcome, ask directly with anchors instead of forcing multiple choice.

**Stability tests** state the real cost, unsoftened: "You said X. In practice X means giving up Y in situation Z. Does it still hold, and why?" A preference that cannot survive its cost was never stable.

Ask which direction pulls the user and why. They may choose, combine, modify, reject, qualify, or defer.

### Batch template

```markdown
## Batch N
One or two sentences: what this batch pins down and why it is ripe now.

### Q1. [Preference in plain language]
[Situation and what it will decide.]
- **A, [name]:** meaning; benefit (why); cost (why).
- **B, [name]:** meaning; benefit (why); cost (why).

**Recommendation:** [choice], assuming [assumptions].
**Question:** Which direction pulls you, and why?

Reply in prose, or:
Q1: ...
Q2: skip
Anything missing: ...
```

## Handling replies

**Skips and gaps**
- "Skip" with a stated default: record the default as an assumption, not a preference.
- "Skip" without a default: leave it open and carry it forward if material.
- No answer: never infer agreement.
- "I don't know", "no preference", or a vague pick on something important: this is a grounding failure. The question was premature, not the user deficient. Do not re-ask it louder, default it silently, or record a shrug as a preference. Explain in plainer terms what the choice concretely changes and costs, mark the entry owed-grounding, and ask again once they can judge.

**Interpretation**
- Read the whole reply before updating anything. Classify each part: preference, constraint, concern, fact to verify, qualification, conflict, information gap, or deferral.
- Keep reasons and qualifications, not just the pick. An incidental pick, or a pick with an objection, does not settle the contested part. A local choice is not automatically a global preference.
- An answer may stabilize a preference, reveal a constraint, expose a conflict, shift the goal, or contradict an earlier answer. Reopen only affected entries and their dependents.
- **Stale answers:** if an earlier answer in the batch invalidates a later question's premise, keep the later answer as context (not a preference), say briefly what changed, and re-ask the revised question next batch.
- **Contradictions:** state the concrete tension and its consequence, then ask which wins, when, and why. Do not flatten qualified answers into agreement. Use interim alignment checks only when inferred assumptions pile up or new information changes the frame, and show only what needs correction.

**Choosing the next probes.** Rank ripe ones by impact, uncertainty, and cost of being wrong later. When the user leans, narrow to the underlying preference and test its edges. When they are vague or hesitant, widen: supply missing context first, create options that favor different competing values, use credible extremes to expose the stakes and then offer a middle path, separate independent dimensions and recombine them, challenge an assumed trade-off with a different approach, and keep only non-dominated options.

## Resolving conflicts and constraints

Every material conflict ends with a priority rule: which preference wins under which conditions, and what the loser concedes, in the user's own framing where possible. First classify it. An **apparent** conflict has wants in different scopes, so resolve by scoping. A **true** conflict has both wants bearing on the same decision, so resolve by priority rule, accepted trade-off, or a third option that dissolves the tension.

Record each constraint with its source and what it rules out, after applying the disguise test. If the user explicitly defers a conflict, mark it deferred with the reason and the later decision it blocks.

## Confirming and delivering

1. Summarize the preferences and reasons, separating explicit from inferred.
2. Name resolved conflicts with their priority rules, deferrals, and material uncertainty.
3. Ask one short confirmation question outside the summary. Reuse confirmation already given if it covers the current understanding; a correction reopens only affected entries.
4. After confirmation, deliver the list without asking whether to write it. The deliverable is the list, not an interview transcript.

```markdown
## Preferences
### [Preference, stated precisely]
- Scope: where it applies and where it does not
- Reason: in the user's terms
- Accepted trade-offs:
- Conflicts resolved: [vs what -> priority rule]
- Status: explicit | inferred | assumed | deferred

## Constraints
- [Boundary]. Source: ... Rules out: ...

## Assumptions
Defaults the user did not state, labeled as such. Never present these as stated preferences.

## Deferred or unresolved
Each item and the later decision it blocks.

## Flagged missing by the user
```

## Checks

**Before sending a batch:** every question is ripe and material; all currently ripe consequential probes are included; dependents are deferred or conditional; each question stands alone with plain-language context and defined terms; each option has a real upside and downside; stability tests carry the real cost; recommendations are provisional with visible assumptions; defaults are safe, reversible, and stated.

**Before delivering:** every material preference passed a cost or conflict test and was decided with enough information; no shrug or vague pick is recorded as stable; assumptions are labeled; conflicts are resolved or explicitly deferred; constraints have sources; the list is complete, not an offer to continue.
