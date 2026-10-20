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
