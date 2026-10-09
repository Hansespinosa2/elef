# Slide reveals

Add a `:::step` directive immediately before a group to reveal that group during Present. Each advance reveals one event while previously revealed groups remain visible. Previous reverses one event; backing up from the first event returns to the preceding slide with all of its events visible.

```markdown
# The Lost Generation

:::step{01}
Fitzgerald's life

:::step{2}
Fitzgerald's books

:::step{1}
Hemingway's life

:::step{2}
Hemingway's books
```

The two `{1}` groups reveal together, followed by both `{2}` groups. Numbered labels are slide-local names, not sort values: events follow the first source occurrence of each label. Leading zeros do not distinguish labels (`{01}` and `{1}` match). An unnumbered `:::step` creates its own event.

The directive attaches to the next contiguous, nonblank source group. Ordinary line breaks stay in the same group; a blank line ends it. In this example only the first list item is stepped, and the second is visible as soon as the slide opens:

```markdown
:::step
- first item

- second item
```

You can stack compatible directives without a blank line. They apply to the same group; if multiple step directives are stacked, the last valid step directive determines that group's event. Stacked alignment directives keep their normal behavior, with the last alignment applying to the group.

```markdown
:::step{3}
:::align{center}
This centered text appears with the group labeled `3`.
```

Headings, lists, tables, images, and math can all be part of a stepped group. Unmarked content is visible from slide entry even if it appears later in the source. Reveals apply in Present mode only; authoring previews, documents, and printed slides show all content.
