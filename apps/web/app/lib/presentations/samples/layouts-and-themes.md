---
elefSampleId: layouts-and-themes
theme: dark
---
:::align{middle center}
# Designing a visual system

:::align {center}
This work exercises automatic layouts while telling a complete story
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

A work can move from dark to light without changing its Markdown.
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

:::align{middle center}

Before presenting, check the sequence at thumbnail scale:

1. Does the visual rhythm vary?
2. Are chapters easy to find?
3. Does the final slide resolve the opening promise?
---
# Design system takeaway

Themes provide atmosphere, layouts provide intent, and Markdown
provides the content. Keeping those responsibilities separate makes the work easier to edit and easier for Elef to render.
---
# Two columns with independent positions

## Bullets

:::align{middle center}

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

:::align{middle center}

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

:::align{middle left}

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

:::align{middle right}

Middle-right content.

## Lower center

:::align{bottom center}

Lower-center content.
