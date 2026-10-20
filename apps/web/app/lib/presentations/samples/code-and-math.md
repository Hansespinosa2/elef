---
elefSampleId: code-and-math
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
  puts "#{size}: #{elapsed.round(2)} ms"
end
puts "$not_math$"
```

Fenced content remains code rather than becoming presentation math.
---
# State the model

For a linear pass through `n` records, the work grows approximately as
(T(n) = an + b). Inline check: $x^2 + y_1$.

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

$$\sum_{i=1}^{n} i = \frac{n(n+1)}{2}$$

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

$$\lim_{n\to\infty} \frac{1}{n} = 0$$
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
changes. A strong technical work uses both to make a decision
reviewable.
