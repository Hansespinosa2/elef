# 04 — Deferred and Open Questions

## Deferred grammar

Do not implement grouped postfix operations; `{x+y}.operator`; automatic scope inference across binary operators; `.hat`, `.abs`, `.sqrt`, `.sum`; structural infix operators; `./`; `.choose`; chained fractions; arbitrary-expression postfix transforms; distribution across terms; or algebraic simplification.

For v1, fractions are `@frac`, combinations are `@choose`, hats are ordinary LaTeX or an `@` insertion, and grouping semantics are undefined.

## Deferred parser scope

No complete TeX parser, whole-document math parsing during ordinary typing, arbitrary-expression AST manipulation, or semantic algebra is required.

## Active-chain preview

After core chain interaction is implemented and tested, evaluate a small translucent cursor-adjacent popup that shows canonical LaTeX and optionally rendered math. It must never replace source before commit, move layout, steal focus, block insertion, or remain when irrelevant. Visual design is open.

## Bold serialization

Verify compatibility with Elef's math renderer/export stack, then define one deterministic serializer. Latin `.b` may use `\\mathbf{...}`; Greek/symbol operands must use a form that actually renders bold, such as `\\boldsymbol{...}`.

## Future evaluation

After v1, evaluate whether postfix chaining reduces keystrokes/cursor movement; whether commit boundaries are understood; whether preview helps; which operations fail due to missing scope; whether usage justifies structural infix syntax; which additional operations recur; and whether style/decorative ordering needs further rules.
