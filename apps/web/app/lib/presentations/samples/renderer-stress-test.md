---
elefSampleId: renderer-stress-test
theme: match
---
# Renderer stress test

This deliberate kitchen-sink work combines the Markdown, layout, code,
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
puts "The source is #{formula}"
```

The renderer must preserve the literal code string while rendering
math outside the fence.
---
# Fractions and superscripts

$$\frac{1}{3} + x^2 + y_1$$

Fractions, superscripts, and subscripts need the complete KaTeX
stylesheet and matching fonts to occupy the correct geometry.
---
# Limits and integrals

$$\int_0^1 x^2\,dx = \frac{1}{3}$$

$$\lim_{n\to\infty} \frac{1}{n} = 0$$

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
