# 02 — Interaction and Technical Contract

## 1. Active math chains

Recognized dot chains stay literal while actively edited. `x.b.vec.t` remains visible until commit. Authors can move through the chain, insert/remove operations, change the base, return to the end, and commit. For example, `x.vec.t` can become `x.b.vec.t` before commitment.

## 2. Optional active-chain preview

A small cursor-adjacent preview may show canonical LaTeX and optionally rendered math. It never replaces source, moves surrounding content, steals focus, delays insertion, or remains when irrelevant. It is visually subordinate and may be omitted for invalid/incomplete chains. Exact appearance is not v1 acceptance.

## 3. Commit behavior

A valid chain canonicalizes on Space, Tab, Enter, cursor leaving the chain, loss of editor focus, or document save/exit. `x.t|` followed by Space becomes `x^{\\mathsf{T}} |`; preserve the space.

Invalid/incomplete chains are preserved exactly: no partial conversion, deletion, or guessing. Suggestions may reopen when an incomplete chain is revisited.

## 4. Undo

Committing one active chain is one undoable editor transaction. One Undo immediately after commitment restores the pre-commit shorthand.

## 5. One authoring registry

Use one logical registry where practical instead of independent snippet, math, Mermaid, and directive implementations. Entries need: id, trigger namespace, canonical name, aliases, search terms, valid contexts, category, insertion/transformation behavior, placeholder positions, argument schema, commit behavior, and documentation example. Math transforms additionally specify operator class, operand class, and canonical serializer. Storage format is an implementation decision.

## 6. Context detection

Distinguish Markdown/source, inline math, display math, code span, code fence, Mermaid block, Elef directive argument, and active math chain. Triggers never activate in invalid contexts: `/` in math, `@` in prose, `.` in prose, `$` pairing in code.

## 7. AST model and parser scope

An AST is an internal representation of mathematical structure rather than raw characters. `x.b.vec.t` represents `Transpose(Vector(Bold(x)))`; canonical `\\vec{\\mathbf{x}}^{\\mathsf{T}}` should be understood as an equivalent local structure where needed. AST is internal and never persisted.

v1 needs no complete TeX parser. It supports atomic operands, supported `@` tokens, supported postfix transforms, and safely recognizable canonical LaTeX atoms. Existing one-symbol forms such as `\\mathbf{x}`, `\\boldsymbol{\\alpha}`, and `\\vec{x}` can be operands for postfix transforms, based only on visible source; grouped or binary expressions are not inferred. During ordinary typing, parse only the active math region, not the whole document.

## 8. Operator classes

- **Style:** `.b`, `.bb`; may target the base and canonicalize independent of purely stylistic/decorative order.
- **Decoration:** `.vec`, `.bar`, `.hat`, `.tilde`; operates on the current atomic object.
- **Mathematical postfix:** `.t`, `.inv`; preserve semantic order.

Never simplify algebra or reorder mathematical operations because they may be equivalent under assumptions.

## 9. Command palettes

Palettes share one interaction model: typing filters; exact canonical matches rank first, exact aliases next, fuzzy semantic matches after; Up/Down navigate; Enter accepts; Escape closes without changing source; ordinary cursor/editing shortcuts work when navigation is inactive; palette focus does not make text navigation unreliable. Directive palettes are restricted to values valid at the current argument position.

Plain Enter between the delimiters of an empty standalone display pair `$$|$$` inserts one blank math line and keeps the caret on that line. Enter behavior in inline math, code, and other source contexts remains unchanged.

## 10. Placeholders

Structured insertions support ordered placeholders. `\\frac{|}{}` uses Tab to move numerator, denominator, then out. The same applies to tables, code blocks, directives, matrices, cases, and diagram templates.

## 11. Performance

No normal keystroke synchronously parses the full document. Parse the smallest relevant region. Preview rendering never blocks editing and stale preview work is discardable.

Performance gate: for a 5,000-character math region and at least 1,000 simulated edits, synchronous assist processing has p95 `< 5 ms`, p99 `< 10 ms`, and no operation `>= 16 ms`.

## 12. Accessibility

Suggestion popups are fully keyboard-operable, expose the active suggestion to assistive technology, have accessible context/name, accept Enter and Escape, and preserve platform-standard editing outside intentional palette navigation. No feature requires a mouse.

## 13. Persistence and transparency

Canonical output has no hidden authorship metadata. After `x.b` commits to `\\mathbf{x}`, it behaves as if typed manually. No hidden dependency on editor history, prior shortcuts, session state, or invisible ids. Incomplete shorthand may remain verbatim.

## 14. Backward compatibility

Visible-content legacy `:` snippets gain `/` as canonical interface; legacy aliases may remain temporarily; docs teach `/`; compatible existing `@` shortcuts remain; uppercase `.T` and aliases such as `.v` may remain; docs prefer `.t` and `.vec`; `/diagram` is canonical Mermaid Assist entry. Compatibility aliases do not appear as duplicate primary commands.
