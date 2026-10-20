---
theme: match
---
# Stress: Renderer kitchen sink

This deliberately dense document combines the content types most
likely to expose interactions between typography, whitespace, and
generated HTML.

**Bold text**, *italic text*, `code`, [a link](https://example.com/contracts),
and an image should all retain clear boundaries.

$$\int_0^1 x^2\,dx = \frac{1}{3}$$

| Layer | Responsibility |
| --- | --- |
| Model | Preserve raw Markdown |
| Parser | Derive document structure |
| Renderer | Produce safe HTML |

```ruby
formula = "$x^2$"
puts "The code fence keeps the formula literal: #{formula}"
```

![Stress-test diagram](https://example.com/stress-test-diagram.png)

A long paragraph exercises wrapping, generated markup, and the
relationship between source whitespace and the final reading surface.
The content is intentionally substantial enough to make regressions
visible without requiring an external asset or network request.
