---
theme: match
show-in-margin:
  section: true
  subsection: true
  footnote: true
  slideCount: true
---
# Fixture: Markdown boundaries

A delimiter-looking line inside a document is a horizontal rule:

---

The same text inside fenced code is data and must remain untouched.

```yaml
---
layout: document
features:
  - links
  - math
```

~~~text
---
~~~

Unicode, punctuation, and long lines should preserve their meaning:
café — naïve façade • “quoted” text • 日本語 • 🚀. This intentionally
long sentence gives wrapping and typography enough material to expose
accidental clipping or an overly narrow reading measure.
