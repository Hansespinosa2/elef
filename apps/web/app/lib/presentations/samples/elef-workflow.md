---
elefSampleId: elef-workflow
theme: dark
---
# From source to stage

A complete Elef workflow turns a Markdown document into a reviewable,
presentable work without losing the source that created it.
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

1. Can a person create a work?
2. Can they save and reopen it?
3. Does presentation mode navigate correctly?
4. Does a failed save preserve their source?
---
# 7. Present the decision

Presentation mode removes editor chrome and keeps attention on the
rendered presentation. Keyboard navigation makes the common path fast.
---
# 8. Learn from the result

A seed library makes these checks repeatable. When a renderer changes,
representative works reveal whether the change improves or regresses
real content.
---
# The workflow is a loop

Draft, save, render, review, present, and improve. Keeping Markdown
canonical means each iteration remains understandable and portable.
---
# The outcome

Elef is easiest to trust when the source, the preview, and the browser
test all tell the same story.
