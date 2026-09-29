# 01 — Product Specification

**Status:** Proposed
**Scope:** Source-mode authoring for documents and presentations

## 1. Goal

Elef should minimize the distance between what the author is thinking and what they must type, while preserving transparent, canonical source formats. Source remains Markdown, LaTeX, Mermaid, and explicit Elef directives. Elef adds faster ways to author those languages; it does not replace them.

## 2. Product doctrine

1. **Source-first.** The source editor remains authoritative.
2. **Canonical output.** Completed assistance resolves to ordinary Markdown, LaTeX, Mermaid, or Elef directives.
3. **Keyboard-to-brain.** Assistance exists where canonical syntax forces unnatural thought or typing.
4. **Do not replace good syntax.** Native syntax such as `x^2`, `x_i`, `+`, `=`, and normal LaTeX commands remain first-class.
5. **Transparent behavior.** Cursor position and visible source determine behavior. No hidden history changes later editing behavior.
6. **Non-destructive editing.** Incomplete or invalid author input is preserved verbatim.
7. **Deterministic behavior.** AI is not required for command interpretation or transformation.
8. **Fast path first.** Frequent operations work without leaving the keyboard.
9. **Discoverability without verbosity.** Fuzzy search understands useful names and synonyms while canonical shortcuts remain short.
10. **No noticeable typing latency.**

## 3. Trigger model

Each trigger has exactly one semantic responsibility.

| Trigger | Meaning | Context |
|---|---|---|
| `/` | Create document content or structure | Source mode outside math |
| `:` | Create/configure Elef-specific directives | Source mode outside math |
| `@` | Find or insert mathematical constructs | Math context |
| `.` | Transform the mathematical object being authored | Math context |
| `$` | Enter/exit math context | Markdown source |

Do not add a feature until its trigger classification is clear.

## 4. `/` — Create

`/` is the primary palette for creating visible document structures. Minimum v1 commands: `/image`, `/table`, `/code`, `/quote`, `/callout`, `/columns`, `/slide`, `/section`, `/footnote`, `/equation`, `/diagram`. Useful contextual arguments include `/table 3x4`, `/code python`, `/columns 2`, and `/diagram sequence`.

Requirements:

- `/` opens a fuzzy command palette.
- Selecting a command inserts canonical source; structured insertions use ordered cursor placeholders where applicable and `Tab` advances through them.
- The command name is absent from committed source.
- Search aliases may be numerous; primary command names remain small and understandable.
- Commands are available only in syntactically appropriate contexts.
- `/diagram` integrates with Mermaid and does not create another diagram language.

## 5. `:` — Direct Elef

`:` is reserved for Elef-specific directives, not ordinary Markdown. Examples: `:align`, `:position`, `:section`, `:subsection`, `:footnote`.

Typing `:align` produces `:::align{|}` with the cursor inside the argument and a directive-specific palette open. `align` may offer `left`, `center`, `right`, `top`, `middle`, `bottom`. For multiple arguments, Space after a completed argument is preserved and offers only valid next arguments. For example, `:::align{center |}` may offer `top`, `middle`, `bottom`.

Each directive defines its canonical name, allowed context, argument count/grammar, enumerable values by position, body behavior, and cursor/placeholder behavior. Suggestions are limited to values valid at the current argument position.

## 6. `@` — Discover and insert math

`@` combines fast known shortcuts and fuzzy discovery; it does not replace LaTeX. Frequent shortcuts include `@a → \\alpha`, `@b → \\beta`, `@g → \\gamma`, `@m → \\mu`, `@n → \\nu`, `@r → \\rho`. Uppercase shortcuts may be case-sensitive, e.g. `@D → \\Delta`. Names such as `alpha`, `gamma`, `rho` are search vocabulary, not necessarily keystrokes.

Larger constructs use readable names: `@frac`, `@choose`, `@cases`, `@equation`, `@gather`, `@matrix`. Expert/legacy aliases such as `beq → equation`, `bga → gather`, and `bcas → cases` affect discovery/ranking, not the set of primary commands.

Requirements: activate only in math; completed insertions resolve to real LaTeX; exact shortcuts rank before semantic matches; direct `\\alpha`, `\\frac`, etc. remain unaffected; useful human vocabulary is recognized without an uncontrolled synonym database.

## 7. `.` — Sequential math transformation

`.` extends a mathematical object in natural thought order. For example `x.b.vec.t` canonicalizes to `\\vec{\\mathbf{x}}^{\\mathsf{T}}`. v1 supports only local postfix transformations with unambiguous scope; it is not a general alternative LaTeX language.

Required transforms:

- `.b` semantic mathematical bold: `x.b → \\mathbf{x}`. Greek uses a valid bold form such as `\\boldsymbol{\\alpha}`.
- `.bb` blackboard bold: `R.bb → \\mathbb{R}`; e.g. `E.bb[X \\mid Y] → \\mathbb{E}[X \\mid Y]`.
- `.vec`: `x.vec → \\vec{x}`.
- `.t`: lowercase canonical transpose name and the repository's canonical transpose representation. `.T` may remain as a compatibility alias; docs/autocomplete show `.t`.
- `.inv`: `A.inv → A^{-1}`.

Styles/decorations may canonicalize to structurally correct LaTeX order (`x.b.vec` and `x.vec.b` may both become `\\vec{\\mathbf{x}}`). Mathematical transforms preserve semantic sequence: `A.inv.t` and `A.t.inv` remain structurally distinct. Never reorder mathematical operations using algebraic identities.

## 8. v1 exclusions

No grouped postfix operations, arbitrary-expression postfix operations, structural infix chaining, `./`, `.choose`, `.hat`, `.abs`, `.sqrt`, `.sum`, algebraic simplification, or automatic distribution. Fractions are `@frac`; combinations are `@choose`; hats are ordinary LaTeX or an `@` insertion until separately designed.

## 9. `$` math pairing

Outside code contexts, `$` should create `$|$`. If the pair is empty and the author immediately types another `$`, promote it to `$$|$$`. Typing an expected closing `$` moves over the existing delimiter. Pairing does not activate inside fenced code, inline code, or for escaped `\\$`.
