---
elefSampleId: slide-edge-cases
theme: light
---
# Stress testing the document boundary

Real documents contain punctuation, fences, long lines, metadata, and
empty-looking content. This work makes those cases visible while
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

Front matter configures the work:

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
(x_1 + x_2 = x_3) in one readable paragraph.

Inline features should not interfere with one another.
---
# Edge-case takeaway

Boundaries should be predictable: metadata is scoped, fences are
respected, and only standalone delimiters split slides.

Predictability is what makes a source-first editor trustworthy.
