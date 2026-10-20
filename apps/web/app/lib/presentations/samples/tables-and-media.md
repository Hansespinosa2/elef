---
elefSampleId: tables-and-media
---
# Communicating a product decision

A decision work combines narrative, comparison, evidence, and a
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
which choice the work recommends.
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
