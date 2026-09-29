# Elef Source Authoring System v1

Implementation-grade specification for source-mode authoring of documents and presentations.

- [01 — Product specification](01-product-spec.md)
- [02 — Interaction and technical contract](02-interaction-technical-contract.md)
- [03 — Verification and acceptance plan](03-verification-acceptance-plan.md)
- [04 — Deferred and open questions](04-deferred-open-questions.md)

Core trigger model: `/` creates visible content and structure; `:` creates or configures Elef directives; `@` discovers and inserts math constructs; `.` transforms the math object being authored; `$` enters or exits math context.

The editor loads one registry containing content snippets, directive schemas, math insertions, and transform metadata. Palettes use that shared registry and keep namespace-specific interactions.

The implementation is complete only when all MUST requirements and acceptance checks in these documents pass. v1 excludes grouped postfix operations, structural infix chaining, algebraic simplification, and arbitrary-expression transforms.
