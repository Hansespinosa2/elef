---
theme: match
---
# Fixture: Rich components

Documents can combine prose with the same semantic content used by
presentations without losing their continuous reading flow.

## Compare the choices

| Approach | Authoring speed | Reviewability | Risk |
| --- | ---: | ---: | ---: |
| Markdown first | High | High | Low |
| Export first | Low | Medium | Medium |
| Design first | Medium | Low | High |

## Show an implementation

```ruby
document = Document.find_by!(title: "Fixture: Rich components")
render(document.source)
```

## Explain the model

The relationship is $E = mc^2$ in inline form, while this display
equation gives the reader a larger landmark:

$$\frac{1}{3} + x^2 + y_1$$

![A representative workflow diagram](https://example.com/elef-workflow.png)

The image, table, code, and equations all remain ordinary Markdown.
