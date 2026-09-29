# 03 — Verification and Acceptance Plan

## 1. Global gate

Accept only when every MUST requirement passes. Reviewers determine pass/fail through automated tests or direct reproduction without interpreting intent.

## 2. `/` tests

- `/image`: typing and accepting inserts valid image source, places cursor in first editable field, and removes `/image` from committed source.
- `/diagram`: Mermaid options appear; choice inserts ordinary Mermaid source; no Elef diagram DSL is persisted.
- `/` in math does not activate the document palette.

## 3. `:` tests

Typing `:align` yields `:::align{|}` and valid arguments. Choosing `center` then Space yields `:::align{center |}` and only valid next arguments, with exact cursor placement.

## 4. `@` tests

Mappings: `@a → \\alpha`, `@b → \\beta`, `@g → \\gamma`, `@D → \\Delta`. Searching `alpha` finds `@a`; exact `@a` ranks first; direct `\\alpha` remains untouched; `@` in prose does not activate. Verify structured insertions `@frac`, `@choose`, `@cases`, `@equation`, `@gather` with canonical LaTeX and placeholder order.

## 5. `.` transform tests

Before commit `x.b` stays literal; after commit it is `\\mathbf{x}`. `@a.b` becomes `\\boldsymbol{\\alpha}` or an explicitly chosen equivalent that renders bold Greek. Also verify `R.bb → \\mathbb{R}`, `x.vec → \\vec{x}`, `x.hat → \\hat{x}`, `x.tilde → \\tilde{x}`, canonical `A.t`, and `A.inv → A^{-1}`. `x.b.vec.t` becomes a structurally correct form such as `\\vec{\\mathbf{x}}^{\\mathsf{T}}`. `@a.hat`, `x.b.hat`, and `x.tilde.t` remain shorthand until commit and then produce valid canonical LaTeX. The following visible-source operands must also work with both `.t` and `.inv`: `x`, `\\mathbf{x}`, and `\\vec{x}`. `A.inv.t` and `A.t.inv` stay structurally distinct; no algebraic reorder.

## 6. Active-chain editing

Start `x.vec.t`, move inside, insert `.b`, observe literal `x.b.vec.t`, move to end, press Tab. It stays literal until Tab and commits all edits to the expected canonical LaTeX.

## 7. Invalid chain

`x.invalid` remains exactly unchanged after commit/leave: no partial conversion, deletion, guessed replacement, or corruption.

## 8. Undo

Commit `x.b` to canonical LaTeX, press Undo once, and verify exact restoration to `x.b`.

## 9. `$` pairing

Outside code, `$` creates `$|$`; immediately typing another `$` in the untouched pair creates `$$|$$`. Fenced code, inline code, and escaped `\\$` get literal dollars; expected closing `$` moves over the existing delimiter.

## 10. Palette tests

For every palette, Down/Up navigate, Enter accepts, Escape closes without changing source, typing filters, mouse is unnecessary, and normal cursor/editing keys work when navigation is inactive.

## 11. Performance test

Run the defined 5,000-character math-region / 1,000-edit benchmark. Pass only if synchronous assist work has p95 `< 5 ms`, p99 `< 10 ms`, and max `< 16 ms`. Preview rendering is excluded from synchronous work and never blocks insertion.

## 12. Cross-mode regression

Documents and presentations behave identically where they share source mode. Existing manually authored Markdown, LaTeX, Mermaid, and Elef directives still render and edit correctly.

## 13. Definition of Done

- [ ] `/`, `:`, `@`, and `.` retain exactly the documented semantic roles.
- [ ] Legacy snippets use the unified model without regressions.
- [ ] `/` inserts canonical content structures.
- [ ] `:` inserts canonical Elef directives and guides valid arguments.
- [ ] `@` supports short math shortcuts and fuzzy discovery.
- [ ] `.` supports only approved v1 transforms.
- [ ] Active chains remain literal until commit.
- [ ] Valid chains commit atomically to canonical LaTeX.
- [ ] Invalid chains are preserved exactly.
- [ ] Undo restores shorthand in one action.
- [ ] `$` pairing passes context tests.
- [ ] Palettes are keyboard accessible.
- [ ] Performance gate passes.
- [ ] Documents and presentations are consistent.
- [ ] No deferred grammar feature was added.
- [ ] Relevant unit, editor/system, regression, and CI checks pass.

Any unchecked box means v1 is incomplete.
